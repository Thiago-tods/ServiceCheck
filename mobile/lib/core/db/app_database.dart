import 'dart:convert';

import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';

part 'app_database.g.dart';

/// Server snapshot of an order exactly as last pulled. Never edited locally:
/// local changes live in [OutboxOps] so local data is never mistaken for server truth.
class OrderRecords extends Table {
  TextColumn get id => text()();
  TextColumn get companyId => text()();
  IntColumn get number => integer()();
  TextColumn get title => text()();
  TextColumn get status => text()();
  IntColumn get version => integer()();
  TextColumn get json => text()();
  TextColumn get serverUpdatedAt => text()();

  @override
  Set<Column<Object>> get primaryKey => {id};
}

/// Pending (and recently settled) operations, in the order the user performed them.
class OutboxOps extends Table {
  IntColumn get seq => integer().autoIncrement()();
  TextColumn get operationId => text().unique()();
  TextColumn get companyId => text()();
  TextColumn get orderId => text()();
  TextColumn get type => text()();
  TextColumn get payload => text()();
  IntColumn get createdAtMs => integer()();

  /// pending | sending | applied | conflict | rejected
  TextColumn get state => text().withDefault(const Constant('pending'))();
  IntColumn get attempts => integer().withDefault(const Constant(0))();
  TextColumn get lastError => text().nullable()();
}

class KvEntries extends Table {
  TextColumn get key => text()();
  TextColumn get value => text()();

  @override
  Set<Column<Object>> get primaryKey => {key};
}

class OpState {
  const OpState._();
  static const pending = 'pending';
  static const sending = 'sending';
  static const applied = 'applied';
  static const conflict = 'conflict';
  static const rejected = 'rejected';
}

@DriftDatabase(tables: [OrderRecords, OutboxOps, KvEntries])
class AppDatabase extends _$AppDatabase {
  AppDatabase(super.e);

  factory AppDatabase.open() => AppDatabase(driftDatabase(name: 'servicecheck'));

  @override
  int get schemaVersion => 1;

  // ---- key/value
  Future<String?> getKv(String key) async {
    final row = await (select(kvEntries)..where((t) => t.key.equals(key))).getSingleOrNull();
    return row?.value;
  }

  Future<void> setKv(String key, String? value) async {
    if (value == null) {
      await (delete(kvEntries)..where((t) => t.key.equals(key))).go();
    } else {
      await into(kvEntries).insertOnConflictUpdate(KvEntriesCompanion.insert(key: key, value: value));
    }
  }

  // ---- orders
  Stream<List<OrderRecord>> watchOrders(String companyId) {
    return (select(orderRecords)
          ..where((t) => t.companyId.equals(companyId))
          ..orderBy([(t) => OrderingTerm.desc(t.number)]))
        .watch();
  }

  Stream<OrderRecord?> watchOrder(String id) {
    return (select(orderRecords)..where((t) => t.id.equals(id))).watchSingleOrNull();
  }

  Future<void> upsertOrders(String companyId, List<Map<String, Object?>> orders) async {
    await batch((b) {
      for (final o in orders) {
        b.insert(
          orderRecords,
          OrderRecordsCompanion.insert(
            id: o['id']! as String,
            companyId: companyId,
            number: o['number']! as int,
            title: o['title']! as String,
            status: o['status']! as String,
            version: o['version']! as int,
            json: jsonEncode(o),
            serverUpdatedAt: o['updatedAt']! as String,
          ),
          mode: InsertMode.insertOrReplace,
        );
      }
    });
  }

  // ---- outbox
  Future<int> enqueue({
    required String operationId,
    required String companyId,
    required String orderId,
    required String type,
    required Map<String, Object?> payload,
  }) {
    return into(outboxOps).insert(
      OutboxOpsCompanion.insert(
        operationId: operationId,
        companyId: companyId,
        orderId: orderId,
        type: type,
        payload: jsonEncode(payload),
        createdAtMs: DateTime.now().millisecondsSinceEpoch,
      ),
    );
  }

  Stream<List<OutboxOp>> watchOutbox(String companyId) {
    return (select(outboxOps)
          ..where((t) => t.companyId.equals(companyId))
          ..orderBy([(t) => OrderingTerm.asc(t.seq)]))
        .watch();
  }

  Future<List<OutboxOp>> outboxToSend(String companyId) {
    return (select(outboxOps)
          ..where((t) => t.companyId.equals(companyId) & t.state.isIn([OpState.pending, OpState.sending]))
          ..orderBy([(t) => OrderingTerm.asc(t.seq)]))
        .get();
  }

  Future<void> setOpState(String operationId, String state, {String? error, bool countAttempt = false}) {
    return customUpdate(
      'UPDATE outbox_ops SET state = ?, last_error = ?, attempts = attempts + ? WHERE operation_id = ?',
      variables: [
        Variable<String>(state),
        Variable<String>(error),
        Variable<int>(countAttempt ? 1 : 0),
        Variable<String>(operationId),
      ],
      updates: {outboxOps},
    );
  }

  /// Operations left sending by a crash go back to the queue; replaying them is safe (idempotent).
  Future<void> resetSending(String companyId) {
    return (update(outboxOps)..where((t) => t.companyId.equals(companyId) & t.state.equals(OpState.sending)))
        .write(const OutboxOpsCompanion(state: Value(OpState.pending)));
  }

  Future<void> deleteOp(String operationId) {
    return (delete(outboxOps)..where((t) => t.operationId.equals(operationId))).go();
  }

  /// Applied operations are kept until a pull confirms their effect is in the server snapshot.
  Future<void> purgeApplied(String companyId) {
    return (delete(outboxOps)
          ..where((t) => t.companyId.equals(companyId) & t.state.equals(OpState.applied)))
        .go();
  }

  Future<void> wipeCompanyData(String companyId) async {
    await (delete(orderRecords)..where((t) => t.companyId.equals(companyId))).go();
    await (delete(outboxOps)..where((t) => t.companyId.equals(companyId))).go();
  }

  Future<void> wipeAll() async {
    await delete(orderRecords).go();
    await delete(outboxOps).go();
    await delete(kvEntries).go();
  }
}