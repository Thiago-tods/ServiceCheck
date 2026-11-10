import 'dart:convert';
import 'dart:io';

import '../../core/db/app_database.dart';
import '../../core/network/api_client.dart';
import '../orders/domain/order_view.dart';
import 'sync_api.dart';

enum SyncPhase { idle, syncing, offline, error }

class SyncStatus {
  const SyncStatus({this.phase = SyncPhase.idle, this.lastSyncAt, this.message});
  final SyncPhase phase;
  final DateTime? lastSyncAt;
  final String? message;

  SyncStatus copyWith({SyncPhase? phase, DateTime? lastSyncAt, String? message}) =>
      SyncStatus(phase: phase ?? this.phase, lastSyncAt: lastSyncAt ?? this.lastSyncAt, message: message);
}

/// Outbox pattern. Push sends the user's operations in order; each carries a stable operationId,
/// so a retry after a lost response is harmless. Pull then refreshes the local copy of the server
/// state. An operation is only treated as done once the server answered APPLIED/DUPLICATE, and its
/// local effect stays visible until a pull confirms it.
class SyncEngine {
  SyncEngine({
    required this.db,
    required this.api,
    required this.companyId,
    this.onStatus,
    this.batchSize = 100,
    this.pullLimit = 100,
  });

  final AppDatabase db;
  final SyncApi api;
  final String companyId;
  final void Function(SyncStatus status)? onStatus;
  final int batchSize;
  final int pullLimit;

  bool _running = false;
  SyncStatus _status = const SyncStatus();
  SyncStatus get status => _status;

  void _emit(SyncStatus s) {
    _status = s;
    onStatus?.call(s);
  }

  String get _cursorKey => 'pullCursor:$companyId';

  /// Returns false if a sync was already running.
  Future<bool> syncNow() async {
    if (_running) return false;
    _running = true;
    _emit(_status.copyWith(phase: SyncPhase.syncing));
    try {
      await db.resetSending(companyId); // operations interrupted by a crash or kill
      await _push();
      await _pull();
      await _purgeApplied();
      _emit(SyncStatus(phase: SyncPhase.idle, lastSyncAt: DateTime.now()));
    } on OfflineException {
      await db.resetSending(companyId);
      _emit(_status.copyWith(phase: SyncPhase.offline));
    } on SessionExpiredException {
      await db.resetSending(companyId);
      _emit(_status.copyWith(phase: SyncPhase.error, message: 'session'));
    } catch (e) {
      await db.resetSending(companyId);
      _emit(_status.copyWith(phase: SyncPhase.error, message: '$e'));
    } finally {
      _running = false;
    }
    return true;
  }

  Future<void> _push() async {
    while (true) {
      final queue = await db.outboxToSend(companyId);
      if (queue.isEmpty) return;

      if (queue.first.type == OpTypes.attachment) {
        if (!await _sendAttachment(queue.first)) return;
        continue;
      }
      final batch = <OutboxOp>[];
      for (final op in queue) {
        if (op.type == OpTypes.attachment || batch.length >= batchSize) break;
        batch.add(op);
      }
      for (final op in batch) {
        await db.setOpState(op.operationId, OpState.sending);
      }
      final List<PushResult> results;
      try {
        results = await api.push([
          for (final op in batch)
            PushOp(
              operationId: op.operationId,
              type: op.type,
              payload: jsonDecode(op.payload) as Map<String, dynamic>,
            ),
        ]);
      } catch (_) {
        for (final op in batch) {
          await db.setOpState(op.operationId, OpState.pending);
        }
        rethrow;
      }

      var stop = false;
      final byId = {for (final r in results) r.operationId: r};
      for (final op in batch) {
        final r = byId[op.operationId];
        if (r == null) {
          await db.setOpState(op.operationId, OpState.pending);
          stop = true;
          continue;
        }
        switch (_resolve(r)) {
          case OpState.applied:
            await db.setOpState(op.operationId, OpState.applied);
          case OpState.conflict:
            await db.setOpState(op.operationId, OpState.conflict, error: jsonEncode(r.error));
          case OpState.rejected:
            await db.setOpState(op.operationId, OpState.rejected, error: jsonEncode(r.error));
          default: // ERROR: unexpected server failure, retry later and keep the order
            await db.setOpState(op.operationId, OpState.pending, error: 'server error', countAttempt: true);
            stop = true;
        }
      }
      if (stop) return;
    }
  }

  /// DUPLICATE means "already processed": it keeps the outcome the operation originally got.
  String _resolve(PushResult r) {
    final outcome = r.outcome == 'DUPLICATE' ? (r.originalOutcome ?? 'APPLIED') : r.outcome;
    return switch (outcome) {
      'APPLIED' => OpState.applied,
      'CONFLICT' => OpState.conflict,
      'REJECTED' => OpState.rejected,
      _ => 'retry',
    };
  }

  /// Returns true when the queue can continue.
  Future<bool> _sendAttachment(OutboxOp op) async {
    final p = jsonDecode(op.payload) as Map<String, dynamic>;
    final file = File(p['path'] as String);
    if (!file.existsSync()) {
      await db.setOpState(op.operationId, OpState.rejected, error: 'file missing');
      return true;
    }
    await db.setOpState(op.operationId, OpState.sending);
    try {
      await api.uploadAttachment(
        id: op.operationId,
        executionId: p['executionId'] as String,
        itemPosition: p['itemPosition'] as int?,
        filename: p['filename'] as String,
        contentType: p['contentType'] as String,
        bytes: await file.readAsBytes(),
      );
      await db.setOpState(op.operationId, OpState.applied);
      return true;
    } on UploadFailure catch (e) {
      final state = e.status == 409 || e.status == 404 || e.status == 403 ? OpState.conflict : OpState.rejected;
      await db.setOpState(op.operationId, state, error: '${e.status}: ${e.message}');
      return true;
    } on OfflineException {
      await db.setOpState(op.operationId, OpState.pending);
      rethrow;
    } catch (e) {
      await db.setOpState(op.operationId, OpState.pending, error: '$e', countAttempt: true);
      return false;
    }
  }

  Future<void> _pull() async {
    var cursor = await db.getKv(_cursorKey);
    for (var page = 0; page < 50; page++) {
      final result = await api.pull(cursor, pullLimit);
      if (result.orders.isNotEmpty) await db.upsertOrders(companyId, result.orders);
      cursor = result.nextCursor ?? cursor;
      if (cursor != null) await db.setKv(_cursorKey, cursor);
      if (!result.hasMore) return;
    }
  }

  Future<void> _purgeApplied() async {
    final applied = (await db.watchOutbox(companyId).first).where((o) => o.state == OpState.applied);
    for (final op in applied) {
      if (op.type == OpTypes.attachment) {
        final path = (jsonDecode(op.payload) as Map<String, dynamic>)['path'] as String?;
        if (path != null) {
          try {
            await File(path).delete();
          } on FileSystemException {
            // already gone
          }
        }
      }
    }
    await db.purgeApplied(companyId);
  }
}