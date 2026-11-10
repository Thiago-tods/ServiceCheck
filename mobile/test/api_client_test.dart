import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicecheck/core/network/api_client.dart';
import 'package:servicecheck/core/network/token_store.dart';

class ScriptedAdapter implements HttpClientAdapter {
  ScriptedAdapter(this.handler);
  final Future<ResponseBody> Function(RequestOptions options) handler;

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) =>
      handler(options);

  @override
  void close({bool force = false}) {}
}

ResponseBody json(int status, Object body) => ResponseBody.fromString(
      jsonEncode(body),
      status,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );

void main() {
  late MemoryTokenStore tokens;
  late int refreshCalls;
  late int expiredCalls;
  late List<String?> seenAuth;
  late List<String?> seenCompany;

  setUp(() async {
    tokens = MemoryTokenStore();
    await tokens.write(const Tokens(access: 'old-access', refresh: 'refresh-1'));
    refreshCalls = 0;
    expiredCalls = 0;
    seenAuth = [];
    seenCompany = [];
  });

  Dio build(Future<ResponseBody> Function(RequestOptions o) handler) {
    return buildDio(
      baseUrl: 'http://test',
      tokens: tokens,
      companyId: () => 'company-1',
      onSessionExpired: () => expiredCalls++,
      adapter: ScriptedAdapter(handler),
    );
  }

  test('adds bearer token and company header', () async {
    final dio = build((o) async {
      seenAuth.add(o.headers['Authorization'] as String?);
      seenCompany.add(o.headers['X-Company-Id'] as String?);
      return json(200, {'ok': true});
    });
    await dio.get<Object?>('/work-orders');
    expect(seenAuth, ['Bearer old-access']);
    expect(seenCompany, ['company-1']);
  });

  test('concurrent 401s trigger one refresh, then every request is retried with the new token', () async {
    final dio = build((o) async {
      if (o.path == '/auth/refresh') {
        refreshCalls++;
        await Future<void>.delayed(const Duration(milliseconds: 20));
        return json(200, {'accessToken': 'new-access', 'refreshToken': 'refresh-2'});
      }
      final auth = o.headers['Authorization'];
      if (auth == 'Bearer old-access') return json(401, {'message': 'expired'});
      return json(200, {'path': o.path, 'auth': auth});
    });
    final results = await Future.wait([
      dio.get<Map<String, dynamic>>('/a'),
      dio.get<Map<String, dynamic>>('/b'),
      dio.get<Map<String, dynamic>>('/c'),
    ]);
    expect(refreshCalls, 1, reason: 'the server revokes a token family if one refresh token is used twice');
    expect(results.map((r) => r.data!['auth']), everyElement('Bearer new-access'));
    final stored = await tokens.read();
    expect(stored!.refresh, 'refresh-2');
    expect(expiredCalls, 0);
  });

  test('a rejected refresh token ends the session and clears the tokens', () async {
    final dio = build((o) async {
      if (o.path == '/auth/refresh') return json(401, {'message': 'reuse'});
      return json(401, {'message': 'expired'});
    });
    await expectLater(dio.get<Object?>('/a'), throwsA(isA<DioException>()));
    expect(expiredCalls, 1);
    expect(await tokens.read(), isNull);
  });

  test('losing the connection during refresh keeps the session', () async {
    final dio = build((o) async {
      if (o.path == '/auth/refresh') throw const SocketLikeException();
      return json(401, {'message': 'expired'});
    });
    await expectLater(dio.get<Object?>('/a'), throwsA(isA<DioException>()));
    expect(expiredCalls, 0);
    expect((await tokens.read())!.refresh, 'refresh-1');
  });

  test('auth endpoints are never retried through refresh', () async {
    final dio = build((o) async {
      if (o.path == '/auth/refresh') refreshCalls++;
      return json(401, {'message': 'invalid credentials'});
    });
    await expectLater(dio.post<Object?>('/auth/login', data: {}), throwsA(isA<DioException>()));
    expect(refreshCalls, 0);
  });

  test('isOfflineError recognises connection failures but not HTTP errors', () {
    final req = RequestOptions(path: '/x');
    expect(isOfflineError(DioException(requestOptions: req, type: DioExceptionType.connectionError)), isTrue);
    expect(isOfflineError(DioException(requestOptions: req, type: DioExceptionType.connectionTimeout)), isTrue);
    expect(
      isOfflineError(
        DioException(
          requestOptions: req,
          type: DioExceptionType.badResponse,
          response: Response<Object?>(requestOptions: req, statusCode: 500),
        ),
      ),
      isFalse,
    );
  });
}

class SocketLikeException implements Exception {
  const SocketLikeException();
}
