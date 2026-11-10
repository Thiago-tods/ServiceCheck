import 'dart:convert';

typedef Json = Map<String, dynamic>;

String? _s(Object? v) => v as String?;
int _i(Object? v) => (v as num?)?.toInt() ?? 0;
List<Json> _list(Object? v) => ((v as List<dynamic>?) ?? const []).cast<Json>();

class ChecklistItemInfo {
  const ChecklistItemInfo({
    required this.position,
    required this.label,
    required this.kind,
    required this.required,
    this.id,
    this.done = false,
    this.value,
  });

  factory ChecklistItemInfo.fromJson(Json j) => ChecklistItemInfo(
        id: _s(j['id']),
        position: _i(j['position']),
        label: j['label'] as String,
        kind: (j['kind'] as String?) ?? 'CHECK',
        required: (j['required'] as bool?) ?? false,
        done: (j['done'] as bool?) ?? false,
        value: _s(j['value']),
      );

  final String? id;
  final int position;
  final String label;
  final String kind;
  final bool required;
  final bool done;
  final String? value;
}

class NoteInfo {
  const NoteInfo({required this.id, required this.text, required this.createdAt});

  factory NoteInfo.fromJson(Json j) => NoteInfo(
        id: j['id'] as String,
        text: j['text'] as String,
        createdAt: DateTime.tryParse(_s(j['createdAt']) ?? '') ?? DateTime.fromMillisecondsSinceEpoch(0),
      );

  final String id;
  final String text;
  final DateTime createdAt;
}

class SignatureInfo {
  const SignatureInfo({required this.status, this.signerName, this.reason});

  factory SignatureInfo.fromJson(Json j) => SignatureInfo(
        status: j['status'] as String,
        signerName: _s(j['signerName']),
        reason: _s(j['reason']),
      );

  final String status; // SIGNED | REFUSED | ABSENT
  final String? signerName;
  final String? reason;
}

class AttachmentInfo {
  const AttachmentInfo({required this.id, required this.filename, this.checklistItemId});

  factory AttachmentInfo.fromJson(Json j) => AttachmentInfo(
        id: j['id'] as String,
        filename: j['filename'] as String,
        checklistItemId: _s(j['checklistItemId']),
      );

  final String id;
  final String filename;
  final String? checklistItemId;
}

class ParticipantInfo {
  const ParticipantInfo({required this.membershipId, required this.isPrimary, required this.active});

  factory ParticipantInfo.fromJson(Json j) => ParticipantInfo(
        membershipId: j['membershipId'] as String,
        isPrimary: (j['isPrimary'] as bool?) ?? false,
        active: j['leftAt'] == null,
      );

  final String membershipId;
  final bool isPrimary;
  final bool active;
}

class ExecutionInfo {
  const ExecutionInfo({
    required this.id,
    required this.sequence,
    required this.status,
    required this.items,
    required this.notes,
    required this.attachments,
    required this.participants,
    this.signature,
    this.reopenReason,
  });

  factory ExecutionInfo.fromJson(Json j) => ExecutionInfo(
        id: j['id'] as String,
        sequence: _i(j['sequence']),
        status: j['status'] as String,
        reopenReason: _s(j['reopenReason']),
        items: _list(j['items']).map(ChecklistItemInfo.fromJson).toList(),
        notes: _list(j['notes']).map(NoteInfo.fromJson).toList(),
        attachments: _list(j['attachments']).map(AttachmentInfo.fromJson).toList(),
        participants: _list(j['participants']).map(ParticipantInfo.fromJson).toList(),
        signature: j['signature'] == null ? null : SignatureInfo.fromJson(j['signature'] as Json),
      );

  final String id;
  final int sequence;
  final String status; // PENDING | IN_PROGRESS | FINISHED
  final String? reopenReason;
  final List<ChecklistItemInfo> items;
  final List<NoteInfo> notes;
  final List<AttachmentInfo> attachments;
  final List<ParticipantInfo> participants;
  final SignatureInfo? signature;
}

class AssignmentInfo {
  const AssignmentInfo({
    required this.id,
    required this.membershipId,
    required this.isPrimary,
    required this.startsAt,
    required this.endsAt,
    required this.active,
  });

  factory AssignmentInfo.fromJson(Json j) => AssignmentInfo(
        id: j['id'] as String,
        membershipId: j['membershipId'] as String,
        isPrimary: (j['isPrimary'] as bool?) ?? false,
        startsAt: DateTime.parse(j['startsAt'] as String),
        endsAt: DateTime.parse(j['endsAt'] as String),
        active: j['releasedAt'] == null,
      );

  final String id;
  final String membershipId;
  final bool isPrimary;
  final DateTime startsAt;
  final DateTime endsAt;
  final bool active;
}

class OrderDetail {
  const OrderDetail({
    required this.id,
    required this.number,
    required this.title,
    required this.status,
    required this.version,
    required this.client,
    required this.checklist,
    required this.assignments,
    required this.executions,
    this.description,
    this.serviceName,
    this.checklistVersion,
  });

  factory OrderDetail.fromJson(Json j) {
    final service = (j['serviceSnapshot'] as Json?) ?? const {};
    return OrderDetail(
      id: j['id'] as String,
      number: _i(j['number']),
      title: j['title'] as String,
      description: _s(j['description']),
      status: j['status'] as String,
      version: _i(j['version']),
      client: (j['clientSnapshot'] as Json?) ?? const {},
      serviceName: _s(service['name']),
      checklistVersion: (service['checklistVersion'] as num?)?.toInt(),
      checklist: _list(service['items']).map(ChecklistItemInfo.fromJson).toList(),
      assignments: _list(j['assignments']).map(AssignmentInfo.fromJson).toList(),
      executions: _list(j['executions']).map(ExecutionInfo.fromJson).toList(),
    );
  }

  factory OrderDetail.fromRecordJson(String raw) => OrderDetail.fromJson(jsonDecode(raw) as Json);

  final String id;
  final int number;
  final String title;
  final String? description;
  final String status;
  final int version;
  final Json client;
  final String? serviceName;
  final int? checklistVersion;
  final List<ChecklistItemInfo> checklist;
  final List<AssignmentInfo> assignments;
  final List<ExecutionInfo> executions;

  String get clientName => (client['name'] as String?) ?? '';

  String get addressLine {
    final a = (client['address'] as Json?) ?? const {};
    final street = [a['street'], a['number']].where((e) => e != null && '$e'.isNotEmpty).join(', ');
    final city = [a['city'], a['state']].where((e) => e != null && '$e'.isNotEmpty).join('/');
    return [street, a['district'], city].where((e) => e != null && '$e'.isNotEmpty).join(' - ');
  }

  List<AssignmentInfo> get activeAssignments => assignments.where((a) => a.active).toList();

  AssignmentInfo? assignmentOf(String membershipId) {
    for (final a in assignments) {
      if (a.active && a.membershipId == membershipId) return a;
    }
    return null;
  }
}