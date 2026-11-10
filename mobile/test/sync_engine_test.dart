import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:servicecheck/core/db/app_database.dart';
import 'package:servicecheck/core/network/api_client.dart';
import 'package:servicecheck/features/orders/domain/order_view.dart';
import 'package:servicecheck/features/sync/sync_api.dart';
import 'package:servicecheck/features/sync/sync_engine.dart';

import 'support/fixtures.dart';

class FakeApi implements SyncApi {
  final pushed = <List<PushOp>>[];
  final uploads = <String>[];
  List<PullPage> pages = [const PullPage(orders: [], hasMore: false, nextCursor: null)];
  final pullSince = <String?>[];
  bool offline = false;
  bool offlineOnPull = false;
  String Function(PushOp op)? outcomeFor;
  String? originalFor;
  UploadFailure? uploadFailure;

  @override
  Future<List<PushResult>> push(List<PushOp> ops) async {
    if (offline) throw const OfflineException();
    pushed.add(ops);
    return [
      for (final op in ops)
        PushResult(
          operationId: op.operationId,
          outcome: outcomeFor?.call(op) ?? 'APPLIED',
          originalOutcome: originalFor,
          error: const {'message': 'server says no'},
        ),
    ];
  }

  @override
  Future<PullPage> pull(String? since, int limit) async {
    if (offline || offlineOnPull) throw const OfflineException();
    pullSince.add(since);
    return pages[(pullSince.length - 1).clamp(0, pages.length - 1)];
  }

  @override
  Future<void> uploadAttachment({
    required String id,
    required String executionId,
    int? itemPosition,
    required String filename,
    required String contentType,
    required List<int> bytes,
  }) async {
    if (offline) throw const OfflineException();
    if (uploadFailure != null) throw uploadFailure!;
    uploads.add(id);
  }
}

void main() {
  late AppDatabase db;
  late FakeApi api;
  late SyncEngine engine;
  final statuses = <SyncPhase>[];

  setUp(() {
    db = memoryDb();
    api = FakeApi();
    statuses.clear();
    engine = SyncEngine(db: db, api: api, companyId: company, onStatus: (s) => statuses.add(s.phase));
  });
  tearDown(() => db.close());

  Future<Map<String, OutboxOp>> ops() async => {for (final o in await db.watchOutbox(company).first) o.operationId: o};

  test('sends operations in the order they were performed, in one batch', () async {
    await addOp(db, OpTypes.start, {'orderId': 'o', 'executionId': 'e'}, operationId: 'a');
    await addOp(db, OpTypes.item, {'executionId': 'e', 'itemPosition': 0, 'done': true}, operationId: 'b');
    await addOp(db, OpTypes.note, {'executionId': 'e', 'text': 'x'}, operationId: 'c');
    await engine.syncNow();
    expect(api.pushed, hasLength(1));
    expect(api.pushed.single.map((o) => o.operationId), ['a', 'b', 'c']);
  });

  test('keeps applied operations until a pull succeeds, then purges them', () async {
    await addOp(db, OpTypes.start, {'orderId': 'o', 'executionId': 'e'}, operationId: 'a');
    api.offlineOnPull = true;
    await engine.syncNow();
    expect((await ops())['a']!.state, OpState.applied, reason: 'effect must stay visible: the snapshot is not refreshed yet');
    expect(engine.status.phase, SyncPhase.offline);

    api.offlineOnPull = false;
    await engine.syncNow();
    expect(await ops(), isEmpty);
    expect(engine.status.phase, SyncPhase.idle);
    expect(engine.status.lastSyncAt, isNotNull);
  });

  test('while offline nothing is lost and nothing is marked as sent', () async {
    await addOp(db, OpTypes.item, {'executionId': 'e', 'itemPosition': 0, 'done': true}, operationId: 'a');
    api.offline = true;
    await engine.syncNow();
    final a = (await ops())['a']!;
    expect(a.state, OpState.pending);
    expect(engine.status.phase, SyncPhase.offline);

    api.offline = false;
    await engine.syncNow();
    expect(api.pushed.single.single.operationId, 'a');
  });

  test('retrying after a lost response is safe: the same operationId is sent again', () async {
    await addOp(db, OpTypes.note, {'executionId': 'e', 'text': 'x'}, operationId: 'a');
    api.offline = true; // request may have reached the server; the response was lost
    await engine.syncNow();
    api.offline = false;
    api.originalFor = 'APPLIED';
    api.outcomeFor = (_) => 'DUPLICATE';
    await engine.syncNow();
    expect(api.pushed.single.single.operationId, 'a');
    expect(await ops(), isEmpty, reason: 'DUPLICATE+APPLIED is a success');
  });

  test('conflicts and rejections are preserved with the server message, never dropped', () async {
    await addOp(db, OpTypes.start, {'orderId': 'o', 'executionId': 'e'}, operationId: 'a');
    await addOp(db, OpTypes.item, {'executionId': 'e', 'itemPosition': 0, 'done': true}, operationId: 'b');
    api.outcomeFor = (op) => op.operationId == 'a' ? 'CONFLICT' : 'REJECTED';
    await engine.syncNow();
    final all = await ops();
    expect(all['a']!.state, OpState.conflict);
    expect(all['b']!.state, OpState.rejected);
    expect(jsonDecode(all['a']!.lastError!), {'message': 'server says no'});
    expect(jsonDecode(all['b']!.payload), containsPair('done', true));
    // They are not retried on the next sync.
    await engine.syncNow();
    expect(api.pushed, hasLength(1));
  });

  test('a replayed conflict keeps its original outcome', () async {
    await addOp(db, OpTypes.start, {'orderId': 'o', 'executionId': 'e'}, operationId: 'a');
    api.outcomeFor = (_) => 'DUPLICATE';
    api.originalFor = 'CONFLICT';
    await engine.syncNow();
    expect((await ops())['a']!.state, OpState.conflict);
  });

  test('an unexpected server error stops the queue and keeps order for the retry', () async {
    await addOp(db, OpTypes.start, {'orderId': 'o', 'executionId': 'e'}, operationId: 'a');
    await addOp(db, OpTypes.item, {'executionId': 'e', 'itemPosition': 0, 'done': true}, operationId: 'b');
    api.outcomeFor = (_) => 'ERROR'; // the server halts the batch: later operations come back retryable too
    await engine.syncNow();
    final all = await ops();
    expect(all['a']!.state, OpState.pending);
    expect(all['a']!.attempts, 1);
    expect(all['b']!.state, OpState.pending);

    api.outcomeFor = null; // next attempt resends both, in the original order
    await engine.syncNow();
    expect(api.pushed.last.map((o) => o.operationId), ['a', 'b']);
  });

  test('operations interrupted mid-send are recovered as pending', () async {
    await addOp(db, OpTypes.start, {'orderId': 'o', 'executionId': 'e'}, operationId: 'a', state: OpState.sending);
    await engine.syncNow();
    expect(api.pushed.single.single.operationId, 'a');
  });

  test('uploads attachments only after the operations queued before them', () async {
    final dir = await Directory.systemTemp.createTemp('sc_test');
    final file = File('${dir.path}/p.jpg')..writeAsBytesSync([1, 2, 3]);
    await addOp(db, OpTypes.start, {'orderId': 'o', 'executionId': 'e'}, operationId: 'a');
    await addOp(db, OpTypes.attachment, {
      'executionId': 'e',
      'path': file.path,
      'filename': 'p.jpg',
      'contentType': 'image/jpeg',
    }, operationId: 'photo');
    await addOp(db, OpTypes.finish, {'executionId': 'e'}, operationId: 'z');
    await engine.syncNow();
    expect(api.pushed.map((b) => b.map((o) => o.operationId).toList()), [
      ['a'],
      ['z'],
    ]);
    expect(api.uploads, ['photo']);
    expect(await ops(), isEmpty);
    expect(file.existsSync(), isFalse, reason: 'the local copy is removed once confirmed and pulled');
    await dir.delete(recursive: true);
  });

  test('a rejected upload is kept for the user instead of blocking the queue forever', () async {
    final dir = await Directory.systemTemp.createTemp('sc_test');
    final file = File('${dir.path}/p.jpg')..writeAsBytesSync([1]);
    await addOp(db, OpTypes.attachment, {
      'executionId': 'e',
      'path': file.path,
      'filename': 'p.jpg',
      'contentType': 'image/jpeg',
    }, operationId: 'photo');
    api.uploadFailure = const UploadFailure(400, 'File content does not match its declared type');
    await engine.syncNow();
    final op = (await ops())['photo']!;
    expect(op.state, OpState.rejected);
    expect(op.lastError, contains('400'));
    expect(file.existsSync(), isTrue, reason: 'the picture is not deleted while unresolved');
    await dir.delete(recursive: true);
  });

  test('pull pages through all changes, stores orders and remembers the cursor', () async {
    api.pages = [
      PullPage(orders: [orderJson(number: 1, id: 'o1')], hasMore: true, nextCursor: '2027-01-01T10:00:00.000Z'),
      PullPage(orders: [orderJson(number: 2, id: 'o2', updatedAt: '2027-01-02T10:00:00.000Z')], hasMore: false, nextCursor: '2027-01-02T10:00:00.000Z'),
    ];
    await engine.syncNow();
    expect(api.pullSince, [null, '2027-01-01T10:00:00.000Z']);
    final stored = await db.watchOrders(company).first;
    expect(stored.map((o) => o.number), [2, 1]);
    expect(await db.getKv('pullCursor:$company'), '2027-01-02T10:00:00.000Z');

    await engine.syncNow();
    expect(api.pullSince.last, '2027-01-02T10:00:00.000Z', reason: 'next sync resumes from the saved cursor');
  });

  test('pull replaces the local server copy of an order but never touches the outbox', () async {
    await addOp(db, OpTypes.item, {'executionId': 'e', 'itemPosition': 0, 'done': true}, operationId: 'a', state: OpState.conflict);
    api.pages = [PullPage(orders: [orderJson(version: 5)], hasMore: false, nextCursor: 'c')];
    await engine.syncNow();
    expect((await db.watchOrders(company).first).single.version, 5);
    expect((await ops())['a']!.state, OpState.conflict);
  });

  test('does not run two syncs at the same time', () async {
    final first = engine.syncNow();
    final second = await engine.syncNow();
    expect(second, isFalse);
    await first;
  });

  test('data of different companies stays separate', () async {
    await db.upsertOrders('another-company', [orderJson(id: 'x1')]);
    await addOp(db, OpTypes.start, {'orderId': 'o', 'executionId': 'e'}, operationId: 'a');
    expect(await db.watchOrders('another-company').first, hasLength(1));
    expect(await db.watchOrders(company).first, isEmpty);
    await db.wipeCompanyData('another-company');
    expect(await db.watchOrders('another-company').first, isEmpty);
    expect((await ops()).keys, ['a']);
  });
}
