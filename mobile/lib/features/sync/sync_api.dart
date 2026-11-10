import 'package:dio/dio.dart';

import '../../core/network/api_client.dart';

class PushOp {
  const PushOp({required this.operationId, required this.type, required this.payload});
  final String operationId;
  final String type;
  final Map<String, dynamic> payload;

  Map<String, dynamic> toJson() => {'operationId': operationId, 'type': type, 'payload': payload};
}

class PushResult {
  const PushResult({required this.operationId, required this.outcome, this.originalOutcome, this.error});

  factory PushResult.fromJson(Map<String, dynamic> j) => PushResult(
        operationId: j['operationId'] as String,
        outcome: j['outcome'] as String,
        originalOutcome: j['originalOutcome'] as String?,
        error: j['error'],
      );

  final String operationId;

  /// APPLIED | DUPLICATE | CONFLICT | REJECTED | ERROR
  final String outcome;
  final String? originalOutcome;
  final Object? error;
}

class PullPage {
  const PullPage({required this.orders, required this.hasMore, required this.nextCursor});

  factory PullPage.fromJson(Map<String, dynamic> j) => PullPage(
        orders: (j['orders'] as List<dynamic>).cast<Map<String, dynamic>>(),
        hasMore: j['hasMore'] as bool,
        nextCursor: j['nextCursor'] as String?,
      );

  final List<Map<String, dynamic>> orders;
  final bool hasMore;
  final String? nextCursor;
}

class UploadFailure implements Exception {
  const UploadFailure(this.status, this.message);
  final int status;
  final String message;
}

abstract class SyncApi {
  /// Throws [OfflineException] when the server cannot be reached.
  Future<List<PushResult>> push(List<PushOp> ops);
  Future<PullPage> pull(String? since, int limit);
  Future<void> uploadAttachment({
    required String id,
    required String executionId,
    int? itemPosition,
    required String filename,
    required String contentType,
    required List<int> bytes,
  });
}

class DioSyncApi implements SyncApi {
  DioSyncApi(this._dio);
  final Dio _dio;

  Never _fail(DioException e) {
    if (isOfflineError(e)) throw const OfflineException();
    if (e.response?.statusCode == 401) throw const SessionExpiredException();
    throw e;
  }

  @override
  Future<List<PushResult>> push(List<PushOp> ops) async {
    try {
      final res = await _dio.post<Map<String, dynamic>>(
        '/sync/push',
        data: {'operations': ops.map((o) => o.toJson()).toList()},
      );
      return (res.data!['results'] as List<dynamic>)
          .map((r) => PushResult.fromJson(r as Map<String, dynamic>))
          .toList();
    } on DioException catch (e) {
      _fail(e);
    }
  }

  @override
  Future<PullPage> pull(String? since, int limit) async {
    try {
      final res = await _dio.get<Map<String, dynamic>>(
        '/sync/pull',
        queryParameters: {'since': ?since, 'limit': limit},
      );
      return PullPage.fromJson(res.data!);
    } on DioException catch (e) {
      _fail(e);
    }
  }

  @override
  Future<void> uploadAttachment({
    required String id,
    required String executionId,
    int? itemPosition,
    required String filename,
    required String contentType,
    required List<int> bytes,
  }) async {
    final form = FormData.fromMap({
      'id': id,
      'checklistItemPosition': ?itemPosition?.toString(),
      'file': MultipartFile.fromBytes(bytes, filename: filename, contentType: DioMediaType.parse(contentType)),
    });
    try {
      await _dio.post<Object?>('/executions/$executionId/attachments', data: form);
    } on DioException catch (e) {
      final status = e.response?.statusCode;
      if (status != null && status != 401 && status < 500) {
        final body = e.response?.data;
        throw UploadFailure(status, body is Map ? '${body['message']}' : 'HTTP $status');
      }
      _fail(e);
    }
  }
}