import 'package:flutter_test/flutter_test.dart';
import 'package:servicecheck/core/db/app_database.dart';
import 'package:servicecheck/features/orders/domain/order_models.dart';
import 'package:servicecheck/features/orders/domain/order_view.dart';

import 'support/fixtures.dart';

void main() {
  late AppDatabase db;
  const orderId = 'o0000000-0000-4000-8000-000000000001';
  const execId = 'e0000000-0000-4000-8000-000000000001';

  setUp(() => db = memoryDb());
  tearDown(() => db.close());

  Future<OrderView> view(Map<String, Object?> order) async {
    final ops = await db.watchOutbox(company).first;
    return OrderView.compose(OrderDetail.fromJson(order), ops);
  }

  test('shows the server snapshot untouched when nothing is pending', () async {
    final v = await view(orderJson());
    expect(v.status, 'SCHEDULED');
    expect(v.statusPending, isFalse);
    expect(v.execution, isNull);
    expect(v.hasPending, isFalse);
  });

  test('a queued start is shown immediately but flagged as not confirmed', () async {
    await addOp(db, OpTypes.start, {'orderId': orderId, 'executionId': execId});
    final v = await view(orderJson());
    expect(v.status, 'IN_PROGRESS');
    expect(v.statusPending, isTrue);
    expect(v.execution!.id, execId);
    expect(v.execution!.isLocalOnly, isTrue);
    expect(v.execution!.items.map((i) => i.item.label), ['Desligar disjuntor', 'Observação', 'Foto final']);
    expect(v.pendingCount, 1);
  });

  test('chained offline operations are applied in order and each is flagged', () async {
    await addOp(db, OpTypes.start, {'orderId': orderId, 'executionId': execId});
    await addOp(db, OpTypes.item, {'executionId': execId, 'itemPosition': 0, 'done': true});
    await addOp(db, OpTypes.item, {'executionId': execId, 'itemPosition': 1, 'value': 'tudo ok'});
    await addOp(db, OpTypes.note, {'executionId': execId, 'text': 'nota offline'}, operationId: 'note-1');
    await addOp(db, OpTypes.signature, {'executionId': execId, 'status': 'ABSENT', 'reason': 'Sem ninguém'});
    final v = await view(orderJson());
    final e = v.execution!;
    expect(e.items[0].item.done, isTrue);
    expect(e.items[0].pending, isTrue);
    expect(e.items[1].item.value, 'tudo ok');
    expect(e.items[1].item.done, isTrue, reason: 'a filled text item counts as done');
    expect(e.items[2].pending, isFalse);
    expect(e.notes.single.text, 'nota offline');
    expect(e.notes.single.pending, isTrue);
    expect(e.signature!.status, 'ABSENT');
    expect(e.requiredDone, isTrue);
    expect(e.hasSignatureStep, isTrue);
  });

  test('finishing offline moves the effective status according to the signature', () async {
    await addOp(db, OpTypes.start, {'orderId': orderId, 'executionId': execId});
    await addOp(db, OpTypes.signature, {'executionId': execId, 'status': 'SIGNED', 'signerName': 'Ana', 'imagePngBase64': 'x'});
    await addOp(db, OpTypes.finish, {'executionId': execId});
    var v = await view(orderJson());
    expect(v.status, 'PENDING_APPROVAL');
    expect(v.execution!.status, 'FINISHED');

    await db.wipeAll();
    await addOp(db, OpTypes.start, {'orderId': orderId, 'executionId': execId});
    await addOp(db, OpTypes.signature, {'executionId': execId, 'status': 'REFUSED', 'reason': 'Recusou assinar'});
    await addOp(db, OpTypes.finish, {'executionId': execId});
    v = await view(orderJson());
    expect(v.status, 'SIGNATURE_REVIEW');
  });

  test('an applied operation stays visible, without the pending flag, until a pull confirms it', () async {
    await addOp(db, OpTypes.start, {'orderId': orderId, 'executionId': execId}, operationId: 's');
    await addOp(db, OpTypes.item, {'executionId': execId, 'itemPosition': 0, 'done': true}, operationId: 'i', state: OpState.applied);
    await db.setOpState('s', OpState.applied);
    final v = await view(orderJson());
    expect(v.execution!.items[0].item.done, isTrue);
    expect(v.execution!.items[0].pending, isFalse);
    expect(v.hasPending, isFalse);
  });

  test('conflicting or rejected operations are not shown as if they had happened', () async {
    await addOp(db, OpTypes.start, {'orderId': orderId, 'executionId': execId}, state: OpState.conflict);
    final v = await view(orderJson());
    expect(v.status, 'SCHEDULED');
    expect(v.execution, isNull);
    expect(v.issueCount, 1);
    expect(v.hasPending, isFalse);
  });

  test('uses the server execution once it exists and avoids duplicating a synced note', () async {
    final server = orderJson(
      status: 'IN_PROGRESS',
      executions: [
        execJson(notes: [
          {'id': 'note-1', 'text': 'nota offline', 'createdAt': '2027-01-10T09:30:00.000Z'},
        ]),
      ],
    );
    await addOp(db, OpTypes.note, {'executionId': execId, 'text': 'nota offline'}, operationId: 'note-1', state: OpState.applied);
    await addOp(db, OpTypes.item, {'executionId': execId, 'itemPosition': 0, 'done': true});
    final v = await view(server);
    expect(v.execution!.isLocalOnly, isFalse);
    expect(v.execution!.notes, hasLength(1));
    expect(v.execution!.items[0].item.done, isTrue);
    expect(v.execution!.items[0].pending, isTrue);
  });

  test('a reopened order reuses the pending execution id and its fresh checklist', () async {
    final server = orderJson(
      executions: [
        execJson(status: 'FINISHED'),
        execJson(id: 'e0000000-0000-4000-8000-000000000002', sequence: 2, status: 'PENDING', reopenReason: 'Refazer acabamento'),
      ],
    );
    final before = await view(server);
    expect(before.execution, isNull, reason: 'a reopened execution is waiting; nothing is running yet');
    expect(before.status, 'SCHEDULED');
    await addOp(db, OpTypes.start, {'orderId': orderId, 'executionId': 'e0000000-0000-4000-8000-000000000002'});
    final v = await view(server);
    expect(v.execution!.id, 'e0000000-0000-4000-8000-000000000002');
    expect(v.execution!.sequence, 2);
    expect(v.status, 'IN_PROGRESS');
  });

  test('closed orders ignore stale pending operations', () async {
    await addOp(db, OpTypes.start, {'orderId': orderId, 'executionId': execId});
    final v = await view(orderJson(status: 'CANCELLED'));
    expect(v.status, 'CANCELLED');
    expect(v.execution, isNull);
  });

  test('a photo attached to a PHOTO item completes it locally and lists the file', () async {
    await addOp(db, OpTypes.start, {'orderId': orderId, 'executionId': execId});
    await addOp(db, OpTypes.attachment, {
      'executionId': execId,
      'itemPosition': 2,
      'path': '/tmp/x.jpg',
      'filename': 'x.jpg',
      'contentType': 'image/jpeg',
    });
    final v = await view(orderJson());
    expect(v.execution!.items[2].item.done, isTrue);
    expect(v.execution!.attachments.single.filename, 'x.jpg');
    expect(v.execution!.attachments.single.pending, isTrue);
  });
}