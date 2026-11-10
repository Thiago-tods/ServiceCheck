import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/db/app_database.dart';
import '../../core/providers.dart';
import '../auth/auth_controller.dart';
import 'domain/order_models.dart';
import 'domain/order_view.dart';

final orderRecordsProvider = StreamProvider<List<OrderRecord>>((ref) {
  final companyId = ref.watch(authProvider.select((a) => a.value?.companyId));
  if (companyId == null) return const Stream.empty();
  return ref.watch(appDatabaseProvider).watchOrders(companyId);
});

final outboxProvider = StreamProvider<List<OutboxOp>>((ref) {
  final companyId = ref.watch(authProvider.select((a) => a.value?.companyId));
  if (companyId == null) return const Stream.empty();
  return ref.watch(appDatabaseProvider).watchOutbox(companyId);
});

/// Server snapshot + unsynced local operations, newest order first.
final orderViewsProvider = Provider<AsyncValue<List<OrderView>>>((ref) {
  final records = ref.watch(orderRecordsProvider);
  final ops = ref.watch(outboxProvider).value ?? const <OutboxOp>[];
  return records.whenData(
    (rows) => [for (final r in rows) OrderView.compose(OrderDetail.fromRecordJson(r.json), ops)],
  );
});

final orderViewProvider = Provider.family<OrderView?, String>((ref, id) {
  final views = ref.watch(orderViewsProvider).value;
  if (views == null) return null;
  for (final v in views) {
    if (v.order.id == id) return v;
  }
  return null;
});

/// Operations the server refused. They stay on the device until the user decides.
final syncIssuesProvider = Provider<List<OutboxOp>>((ref) {
  final ops = ref.watch(outboxProvider).value ?? const <OutboxOp>[];
  return ops.where((o) => o.state == OpState.conflict || o.state == OpState.rejected).toList();
});

final pendingCountProvider = Provider<int>((ref) {
  final ops = ref.watch(outboxProvider).value ?? const <OutboxOp>[];
  return ops.where((o) => o.state == OpState.pending || o.state == OpState.sending).length;
});