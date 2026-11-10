import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_client.dart';
import '../../core/network/token_store.dart';
import '../../core/providers.dart';
import 'session.dart';

class InvalidCredentials implements Exception {
  const InvalidCredentials();
}

class AuthState {
  const AuthState({this.session, this.companyId});
  static const signedOut = AuthState();

  final Session? session;
  final String? companyId;

  bool get authenticated => session != null;
  Membership? get membership => session?.membershipFor(companyId);
}

final authProvider = AsyncNotifierProvider<AuthController, AuthState>(AuthController.new);

class AuthController extends AsyncNotifier<AuthState> {
  static const _sessionKey = 'session';
  static const _companyKey = 'companyId';

  @override
  Future<AuthState> build() async {
    final db = ref.read(appDatabaseProvider);
    final tokens = await ref.read(tokenStoreProvider).read();
    final raw = await db.getKv(_sessionKey);
    if (tokens == null || raw == null) return AuthState.signedOut;
    final session = Session.decode(raw);
    return AuthState(session: session, companyId: _pickCompany(session, await db.getKv(_companyKey)));
  }

  String? _pickCompany(Session session, String? saved) {
    if (session.membershipFor(saved) != null) return saved;
    return session.memberships.length == 1 ? session.memberships.first.companyId : null;
  }

  Future<void> login(String email, String password) async {
    final dio = ref.read(dioProvider);
    try {
      final res = await dio.post<Map<String, dynamic>>(
        '/auth/login',
        data: {'email': email.trim(), 'password': password},
        options: Options(extra: {'skipCompany': true}),
      );
      final body = res.data!;
      await ref.read(tokenStoreProvider).write(
            Tokens(access: body['accessToken'] as String, refresh: body['refreshToken'] as String),
          );
      final me = await dio.get<Map<String, dynamic>>('/auth/me', options: Options(extra: {'skipCompany': true}));
      final session = Session.fromMe(me.data!);
      final db = ref.read(appDatabaseProvider);
      final previous = await db.getKv(_sessionKey);
      if (previous != null && Session.decode(previous).userId != session.userId) {
        await db.wipeAll(); // another person on the same device: never mix data
      }
      await db.setKv(_sessionKey, session.encode());
      state = AsyncData(AuthState(session: session, companyId: _pickCompany(session, await db.getKv(_companyKey))));
    } on DioException catch (e) {
      if (e.response?.statusCode == 401) throw const InvalidCredentials();
      if (isOfflineError(e)) throw const OfflineException();
      rethrow;
    }
  }

  Future<void> selectCompany(String companyId) async {
    final current = state.value;
    if (current == null || current.session?.membershipFor(companyId) == null) return;
    await ref.read(appDatabaseProvider).setKv(_companyKey, companyId);
    state = AsyncData(AuthState(session: current.session, companyId: companyId));
  }

  /// Refreshes memberships when online; failures are ignored so the app keeps working offline.
  Future<void> refreshSession() async {
    final current = state.value;
    if (current == null || !current.authenticated) return;
    try {
      final me = await ref.read(dioProvider).get<Map<String, dynamic>>(
            '/auth/me',
            options: Options(extra: {'skipCompany': true}),
          );
      final session = Session.fromMe(me.data!);
      await ref.read(appDatabaseProvider).setKv(_sessionKey, session.encode());
      state = AsyncData(AuthState(session: session, companyId: _pickCompany(session, current.companyId)));
    } on DioException {
      // offline or token problem: keep the cached session
    }
  }

  Future<void> logout() async {
    final tokens = ref.read(tokenStoreProvider);
    final current = await tokens.read();
    if (current != null) {
      try {
        await ref
            .read(dioProvider)
            .post<Object?>('/auth/logout', data: {'refreshToken': current.refresh});
      } on DioException {
        // best effort: the local wipe below is what matters on this device
      }
    }
    await tokens.clear();
    await ref.read(appDatabaseProvider).wipeAll();
    state = const AsyncData(AuthState.signedOut);
  }

  /// The server rejected the refresh token: the session is over, but local data is kept
  /// until the same user signs in again.
  void sessionExpired() {
    state = const AsyncData(AuthState.signedOut);
  }
}