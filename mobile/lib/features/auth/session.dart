import 'dart:convert';

class Membership {
  const Membership({
    required this.membershipId,
    required this.companyId,
    required this.companyName,
    required this.role,
  });

  factory Membership.fromJson(Map<String, dynamic> j) => Membership(
        membershipId: j['membershipId'] as String,
        companyId: j['companyId'] as String,
        companyName: j['companyName'] as String,
        role: j['role'] as String,
      );

  Map<String, dynamic> toJson() => {
        'membershipId': membershipId,
        'companyId': companyId,
        'companyName': companyName,
        'role': role,
      };

  final String membershipId;
  final String companyId;
  final String companyName;
  final String role;

  bool get isManager => role == 'OWNER' || role == 'ADMIN';
}

class Session {
  const Session({required this.userId, required this.name, required this.email, required this.memberships});

  factory Session.fromMe(Map<String, dynamic> me) {
    final user = me['user'] as Map<String, dynamic>;
    return Session(
      userId: user['id'] as String,
      name: user['name'] as String,
      email: user['email'] as String,
      memberships: (me['memberships'] as List<dynamic>)
          .map((m) => Membership.fromJson(m as Map<String, dynamic>))
          .toList(),
    );
  }

  factory Session.decode(String raw) {
    final j = jsonDecode(raw) as Map<String, dynamic>;
    return Session(
      userId: j['userId'] as String,
      name: j['name'] as String,
      email: j['email'] as String,
      memberships: (j['memberships'] as List<dynamic>)
          .map((m) => Membership.fromJson(m as Map<String, dynamic>))
          .toList(),
    );
  }

  String encode() => jsonEncode({
        'userId': userId,
        'name': name,
        'email': email,
        'memberships': memberships.map((m) => m.toJson()).toList(),
      });

  final String userId;
  final String name;
  final String email;
  final List<Membership> memberships;

  Membership? membershipFor(String? companyId) {
    for (final m in memberships) {
      if (m.companyId == companyId) return m;
    }
    return null;
  }
}