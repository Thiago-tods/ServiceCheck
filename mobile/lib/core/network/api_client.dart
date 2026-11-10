import 'dart:async';

import 'package:dio/dio.dart';

import 'token_store.dart';

/// The device cannot reach the server (offline, timeout, DNS...). Never a business error.
class OfflineException implements Exception {
  const OfflineException();
  @override
  String toString() => 'OfflineException';
}

class SessionExpiredException implements Exception {
  const SessionExpiredException();
  @override
  String toString() => 'SessionExpiredException';
}

bool isOfflineError(DioException e) {
  return e.response == null &&
      (e.type == DioExceptionType.connectionError ||
          e.type == DioExceptionType.connectionTimeout ||
          e.type == DioExceptionType.sendTimeout ||
          e.type == DioExceptionType.receiveTimeout ||
          e.type == DioExceptionType.unknown);
}

/// Dio with bearer auth, X-Company-Id, and single-flight refresh-token rotation:
/// when several requests hit 401 together, only one refresh runs (the server revokes
/// the whole token family if the same refresh token is presented twice).
Dio buildDio({
  required String baseUrl,
  required TokenStore tokens,
  required String? Function() companyId,
  required void Function() onSessionExpired,
  HttpClientAdapter? adapter,
}) {
  final options = BaseOptions(
    baseUrl: baseUrl,
    connectTimeout: const Duration(seconds: 10),
    receiveTimeout: const Duration(seconds: 30),
    contentType: Headers.jsonContentType,
  );
  final dio = Dio(options);
  final bare = Dio(options); // no interceptors: used for /auth/refresh
  if (adapter != null) {
    dio.httpClientAdapter = adapter;
    bare.httpClientAdapter = adapter;
  }

  Future<bool>? refreshing;

  Future<bool> refresh() async {
    final current = await tokens.read();
    if (current == null) return false;
    try {
      final res = await bare.post<Map<String, dynamic>>(
        '/auth/refresh',
        data: {'refreshToken': current.refresh},
      );
      final body = res.data!;
      await tokens.write(Tokens(access: body['accessToken'] as String, refresh: body['refreshToken'] as String));
      return true;
    } on DioException catch (e) {
      if (e.response?.statusCode == 401) {
        await tokens.clear();
        return false;
      }
      rethrow; // offline or server down: keep the session
    }
  }

  dio.interceptors.add(
    InterceptorsWrapper(
      onRequest: (req, handler) async {
        final t = await tokens.read();
        if (t != null && !req.headers.containsKey('Authorization')) {
          req.headers['Authorization'] = 'Bearer ${t.access}';
        }
        final company = companyId();
        if (company != null && req.extra['skipCompany'] != true) req.headers['X-Company-Id'] = company;
        handler.next(req);
      },
      onError: (err, handler) async {
        final req = err.requestOptions;
        final isAuthCall = req.path.startsWith('/auth/');
        if (err.response?.statusCode != 401 || isAuthCall || req.extra['retried'] == true) {
          return handler.next(err);
        }
        try {
          refreshing ??= refresh().whenComplete(() => refreshing = null);
          final ok = await refreshing!;
          if (!ok) {
            onSessionExpired();
            return handler.next(err);
          }
          final t = await tokens.read();
          req.headers['Authorization'] = 'Bearer ${t!.access}';
          req.extra['retried'] = true;
          handler.resolve(await dio.fetch<dynamic>(req));
        } on DioException catch (e) {
          handler.next(e);
        }
      },
    ),
  );
  return dio;
}