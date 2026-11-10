import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:uuid/uuid.dart';

import '../../core/db/app_database.dart';
import '../../core/network/api_client.dart';
import '../../core/providers.dart';
import '../auth/auth_controller.dart';
import '../sync/sync_controller.dart';
import 'domain/order_view.dart';

final orderActionsProvider = Provider<OrderActions>(OrderActions.new);

/// Everything the user does while working an order. Each action is written to the local outbox
/// first (so it survives closing the app) and then handed to the sync engine.
class OrderActions {
  OrderActions(this._ref);
  final Ref _ref;
  static const _uuid = Uuid();

  AppDatabase get _db => _ref.read(appDatabaseProvider);
  String get _companyId => _ref.read(authProvider).value!.companyId!;

  Future<void> _enqueue(String orderId, String type, Map<String, Object?> payload, {String? operationId}) async {
    await _db.enqueue(
      operationId: operationId ?? _uuid.v4(),
      companyId: _companyId,
      orderId: orderId,
      type: type,
      payload: payload,
    );
    _ref.read(syncProvider.notifier).requestSync();
  }

  /// Returns the execution id: the server's pending one (after a reopening) or a fresh UUID
  /// that the server will adopt, so follow-up operations can be queued before any sync.
  Future<String> startExecution(OrderView view) async {
    final pending = view.order.executions.where((e) => e.status == 'PENDING').lastOrNull;
    final executionId = pending?.id ?? _uuid.v4();
    await _enqueue(view.order.id, OpTypes.start, {'orderId': view.order.id, 'executionId': executionId});
    return executionId;
  }

  Future<void> setItem(OrderView view, ItemView item, {bool? done, String? value}) {
    final exec = view.execution!;
    return _enqueue(view.order.id, OpTypes.item, {
      'executionId': exec.id,
      'itemPosition': item.item.position,
      'done': ?done,
      'value': ?value,
    });
  }

  Future<void> addNote(OrderView view, String text) {
    return _enqueue(view.order.id, OpTypes.note, {'executionId': view.execution!.id, 'text': text.trim()});
  }

  Future<void> setSignature(
    OrderView view, {
    required String status,
    String? signerName,
    String? reason,
    String? imagePngBase64,
  }) {
    return _enqueue(view.order.id, OpTypes.signature, {
      'executionId': view.execution!.id,
      'status': status,
      'signerName': ?signerName,
      'reason': ?reason,
      'imagePngBase64': ?imagePngBase64,
    });
  }

  Future<void> finish(OrderView view) {
    return _enqueue(view.order.id, OpTypes.finish, {'executionId': view.execution!.id});
  }

  /// Copies the picture into app storage first: the gallery/camera temp file may disappear
  /// before the device is back online.
  Future<void> attachPhoto(OrderView view, String sourcePath, {int? itemPosition}) async {
    final id = _uuid.v4();
    final ext = p.extension(sourcePath).toLowerCase();
    final contentType = switch (ext) {
      '.png' => 'image/png',
      '.webp' => 'image/webp',
      _ => 'image/jpeg',
    };
    final dir = Directory(p.join((await getApplicationDocumentsDirectory()).path, 'outbox_files'));
    await dir.create(recursive: true);
    final stored = p.join(dir.path, '$id${ext.isEmpty ? '.jpg' : ext}');
    await File(sourcePath).copy(stored);
    await _enqueue(
      view.order.id,
      OpTypes.attachment,
      {
        'executionId': view.execution!.id,
        'itemPosition': ?itemPosition,
        'path': stored,
        'filename': p.basename(sourcePath),
        'contentType': contentType,
      },
      operationId: id,
    );
  }

  Future<void> discard(OutboxOp op) async {
    await _db.deleteOp(op.operationId);
  }

  // ---- online-only actions (office decisions that must not be queued)
  Future<void> _post(String path, Map<String, Object?> body) async {
    try {
      await _ref.read(dioProvider).post<Object?>(path, data: body);
    } on DioException catch (e) {
      if (isOfflineError(e)) throw const OfflineException();
      rethrow;
    }
    await _ref.read(syncProvider.notifier).syncNow();
  }

  Future<void> approve(String orderId, {String? note}) =>
      _post('/work-orders/$orderId/approve', {'note': ?note});

  Future<void> reviewSignature(String orderId, {required bool accept, required String note}) =>
      _post('/work-orders/$orderId/signature-review', {'decision': accept ? 'ACCEPT' : 'RETURN', 'note': note});
}