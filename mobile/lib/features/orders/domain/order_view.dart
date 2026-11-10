import 'dart:convert';

import '../../../core/db/app_database.dart';
import 'order_models.dart';

class OpTypes {
  const OpTypes._();
  static const start = 'EXECUTION_START';
  static const item = 'ITEM_UPDATE';
  static const note = 'NOTE_ADD';
  static const signature = 'SIGNATURE_SET';
  static const finish = 'EXECUTION_FINISH';

  /// Not part of /sync/push: a multipart upload, sent in order after its predecessors.
  static const attachment = 'ATTACHMENT';
}

class ItemView {
  const ItemView({required this.item, required this.pending});
  final ChecklistItemInfo item;

  /// True while the change exists only on this device.
  final bool pending;
}

class NoteView {
  const NoteView({required this.id, required this.text, required this.createdAt, required this.pending});
  final String id;
  final String text;
  final DateTime createdAt;
  final bool pending;
}

class SignatureView {
  const SignatureView({required this.status, required this.pending, this.signerName, this.reason});
  final String status;
  final String? signerName;
  final String? reason;
  final bool pending;
}

class AttachmentView {
  const AttachmentView({required this.filename, required this.pending});
  final String filename;
  final bool pending;
}

class ExecutionView {
  const ExecutionView({
    required this.id,
    required this.sequence,
    required this.status,
    required this.isLocalOnly,
    required this.items,
    required this.notes,
    required this.attachments,
    this.signature,
  });

  final String id;
  final int sequence;
  final String status; // PENDING | IN_PROGRESS | FINISHED (effective, including pending ops)
  final bool isLocalOnly; // the server does not know this execution yet
  final List<ItemView> items;
  final List<NoteView> notes;
  final List<AttachmentView> attachments;
  final SignatureView? signature;

  bool get requiredDone => items.every((i) => !i.item.required || i.item.done);
  bool get hasSignatureStep => signature != null;
}

/// What the user sees: the last server snapshot with the device's unsynced operations applied.
/// Every value changed by a pending operation is flagged, so local data is never presented
/// as if the server had confirmed it.
class OrderView {
  const OrderView({
    required this.order,
    required this.status,
    required this.statusPending,
    required this.execution,
    required this.pendingCount,
    required this.issueCount,
  });

  final OrderDetail order;
  final String status;
  final bool statusPending;
  final ExecutionView? execution;
  final int pendingCount;
  final int issueCount;

  bool get hasPending => pendingCount > 0;

  static const _overlayStates = {OpState.pending, OpState.sending, OpState.applied};
  static const _unsyncedStates = {OpState.pending, OpState.sending};

  static OrderView compose(OrderDetail order, List<OutboxOp> allOps) {
    final mine = allOps.where((o) => o.orderId == order.id).toList()..sort((a, b) => a.seq.compareTo(b.seq));
    final issues = mine.where((o) => o.state == OpState.conflict || o.state == OpState.rejected).length;
    final pending = mine.where((o) => _unsyncedStates.contains(o.state)).length;
    final ops = mine.where((o) => _overlayStates.contains(o.state)).toList();
    final closed = order.status == 'CANCELLED' || order.status == 'APPROVED';

    ExecutionInfo? base;
    for (final e in order.executions) {
      if (e.status == 'IN_PROGRESS') base = e;
    }
    base ??= order.executions.where((e) => e.status == 'PENDING').lastOrNull;
    final finishedBase = base == null ? order.executions.where((e) => e.status == 'FINISHED').lastOrNull : null;

    Map<String, dynamic> payload(OutboxOp o) => jsonDecode(o.payload) as Map<String, dynamic>;

    final startOp = closed ? null : ops.where((o) => o.type == OpTypes.start).lastOrNull;
    var status = order.status;
    var statusPending = false;

    // ---- the execution being worked on
    String? execId;
    var sequence = 1;
    var isLocal = false;
    var execStatus = 'IN_PROGRESS';
    var items = <ChecklistItemInfo>[];
    var notes = <NoteView>[];
    var attachments = <AttachmentView>[];
    SignatureView? signature;
    var hasExecution = false;

    if (base != null && base.status == 'IN_PROGRESS') {
      hasExecution = true;
      execId = base.id;
      sequence = base.sequence;
      items = base.items;
      notes = base.notes.map((n) => NoteView(id: n.id, text: n.text, createdAt: n.createdAt, pending: false)).toList();
      attachments = base.attachments.map((a) => AttachmentView(filename: a.filename, pending: false)).toList();
      if (base.signature != null) {
        signature = SignatureView(
          status: base.signature!.status,
          signerName: base.signature!.signerName,
          reason: base.signature!.reason,
          pending: false,
        );
      }
    } else if (startOp != null) {
      hasExecution = true;
      final p = payload(startOp);
      execId = (base?.id) ?? p['executionId'] as String?;
      sequence = base?.sequence ?? (order.executions.length + 1);
      isLocal = base == null;
      items = base?.items ?? order.checklist;
      status = 'IN_PROGRESS';
      statusPending = _unsyncedStates.contains(startOp.state);
    } else if (finishedBase != null) {
      hasExecution = true;
      execId = finishedBase.id;
      sequence = finishedBase.sequence;
      execStatus = 'FINISHED';
      items = finishedBase.items;
      notes = finishedBase.notes
          .map((n) => NoteView(id: n.id, text: n.text, createdAt: n.createdAt, pending: false))
          .toList();
      attachments = finishedBase.attachments.map((a) => AttachmentView(filename: a.filename, pending: false)).toList();
      if (finishedBase.signature != null) {
        signature = SignatureView(
          status: finishedBase.signature!.status,
          signerName: finishedBase.signature!.signerName,
          reason: finishedBase.signature!.reason,
          pending: false,
        );
      }
    }

    final itemViews = [for (final i in items) ItemView(item: i, pending: false)];

    if (hasExecution && execStatus != 'FINISHED' && !closed) {
      for (final op in ops) {
        final p = payload(op);
        final unsynced = _unsyncedStates.contains(op.state);
        switch (op.type) {
          case OpTypes.item:
            if (p['executionId'] != execId) break;
            final idx = _indexOfItem(itemViews, p);
            if (idx < 0) break;
            final current = itemViews[idx].item;
            final value = p.containsKey('value') ? ((p['value'] as String?)?.isEmpty ?? true ? null : p['value'] as String?) : current.value;
            final done = p['done'] as bool? ??
                (p.containsKey('value') && (current.kind == 'TEXT' || current.kind == 'NUMBER') ? value != null : current.done);
            itemViews[idx] = ItemView(
              item: ChecklistItemInfo(
                id: current.id,
                position: current.position,
                label: current.label,
                kind: current.kind,
                required: current.required,
                done: done,
                value: value,
              ),
              pending: itemViews[idx].pending || unsynced,
            );
          case OpTypes.note:
            if (p['executionId'] != execId) break;
            if (notes.any((n) => n.id == op.operationId)) break; // already in the server snapshot
            notes = [
              ...notes,
              NoteView(
                id: op.operationId,
                text: p['text'] as String,
                createdAt: DateTime.fromMillisecondsSinceEpoch(op.createdAtMs),
                pending: unsynced,
              ),
            ];
          case OpTypes.signature:
            if (p['executionId'] != execId) break;
            signature = SignatureView(
              status: p['status'] as String,
              signerName: p['signerName'] as String?,
              reason: p['reason'] as String?,
              pending: unsynced,
            );
          case OpTypes.attachment:
            if (p['executionId'] != execId) break;
            attachments = [...attachments, AttachmentView(filename: p['filename'] as String, pending: unsynced)];
            final pos = p['itemPosition'] as int?;
            if (pos != null) {
              final idx = itemViews.indexWhere((v) => v.item.position == pos);
              if (idx >= 0 && itemViews[idx].item.kind == 'PHOTO') {
                final c = itemViews[idx].item;
                itemViews[idx] = ItemView(
                  item: ChecklistItemInfo(
                    id: c.id,
                    position: c.position,
                    label: c.label,
                    kind: c.kind,
                    required: c.required,
                    done: true,
                    value: c.value,
                  ),
                  pending: itemViews[idx].pending || unsynced,
                );
              }
            }
          case OpTypes.finish:
            if (p['executionId'] != execId) break;
            execStatus = 'FINISHED';
            status = signature?.status == 'SIGNED' ? 'PENDING_APPROVAL' : 'SIGNATURE_REVIEW';
            statusPending = unsynced;
        }
      }
    }

    return OrderView(
      order: order,
      status: status,
      statusPending: statusPending,
      execution: hasExecution && execId != null
          ? ExecutionView(
              id: execId,
              sequence: sequence,
              status: execStatus,
              isLocalOnly: isLocal,
              items: itemViews,
              notes: notes,
              attachments: attachments,
              signature: signature,
            )
          : null,
      pendingCount: pending,
      issueCount: issues,
    );
  }

  static int _indexOfItem(List<ItemView> items, Map<String, dynamic> p) {
    if (p['itemId'] != null) return items.indexWhere((v) => v.item.id == p['itemId']);
    final pos = p['itemPosition'];
    return pos is int ? items.indexWhere((v) => v.item.position == pos) : -1;
  }
}