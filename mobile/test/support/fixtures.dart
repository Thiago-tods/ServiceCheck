import 'dart:convert';

import 'package:drift/native.dart';
import 'package:servicecheck/core/db/app_database.dart';

const company = 'c0000000-0000-4000-8000-000000000001';
const me = 'm0000000-0000-4000-8000-000000000001';

AppDatabase memoryDb() => AppDatabase(NativeDatabase.memory());

Map<String, Object?> orderJson({
  String id = 'o0000000-0000-4000-8000-000000000001',
  int number = 1,
  String status = 'SCHEDULED',
  int version = 2,
  List<Map<String, Object?>> executions = const [],
  String updatedAt = '2027-01-01T10:00:00.000Z',
}) {
  return {
    'id': id,
    'number': number,
    'title': 'Trocar tomada',
    'description': null,
    'status': status,
    'version': version,
    'updatedAt': updatedAt,
    'clientSnapshot': {
      'name': 'Maria Silva',
      'address': {'street': 'Rua A', 'number': '10', 'city': 'São Paulo', 'state': 'SP'},
    },
    'serviceSnapshot': {
      'name': 'Instalação',
      'checklistVersion': 1,
      'items': [
        {'position': 0, 'label': 'Desligar disjuntor', 'kind': 'CHECK', 'required': true},
        {'position': 1, 'label': 'Observação', 'kind': 'TEXT', 'required': false},
        {'position': 2, 'label': 'Foto final', 'kind': 'PHOTO', 'required': false},
      ],
    },
    'assignments': [
      {
        'id': 'a0000000-0000-4000-8000-000000000001',
        'membershipId': me,
        'isPrimary': true,
        'startsAt': '2027-01-10T09:00:00.000Z',
        'endsAt': '2027-01-10T11:00:00.000Z',
        'releasedAt': null,
      },
    ],
    'executions': executions,
  };
}

Map<String, Object?> execJson({
  String id = 'e0000000-0000-4000-8000-000000000001',
  int sequence = 1,
  String status = 'IN_PROGRESS',
  List<Map<String, Object?>>? items,
  List<Map<String, Object?>> notes = const [],
  Map<String, Object?>? signature,
  String? reopenReason,
}) {
  return {
    'id': id,
    'sequence': sequence,
    'status': status,
    'reopenReason': reopenReason,
    'participants': [
      {'membershipId': me, 'isPrimary': true, 'leftAt': null},
    ],
    'items': items ??
        [
          {'id': 'i1', 'position': 0, 'label': 'Desligar disjuntor', 'kind': 'CHECK', 'required': true, 'done': false, 'value': null},
          {'id': 'i2', 'position': 1, 'label': 'Observação', 'kind': 'TEXT', 'required': false, 'done': false, 'value': null},
          {'id': 'i3', 'position': 2, 'label': 'Foto final', 'kind': 'PHOTO', 'required': false, 'done': false, 'value': null},
        ],
    'notes': notes,
    'attachments': <Object?>[],
    'signature': signature,
  };
}

/// Inserts an outbox row directly, bypassing the UI actions.
Future<void> addOp(
  AppDatabase db,
  String type,
  Map<String, Object?> payload, {
  String? orderId,
  String? operationId,
  String state = OpState.pending,
  String? error,
}) async {
  final id = operationId ?? 'op-${DateTime.now().microsecondsSinceEpoch}-${payload.hashCode}';
  await db.enqueue(
    operationId: id,
    companyId: company,
    orderId: orderId ?? 'o0000000-0000-4000-8000-000000000001',
    type: type,
    payload: payload,
  );
  if (state != OpState.pending) await db.setOpState(id, state, error: error);
}

String prettyJson(Object? o) => const JsonEncoder.withIndent('  ').convert(o);