import 'dart:convert';

import 'l10n.dart';

/// What the app knows about an error the server returned for a synced operation.
///
/// The API does not send application error codes, so the stable identifier is the HTTP status
/// (`statusCode` in Nest's error body, or the `400: ...` prefix the upload path stores).
/// The server's own text is kept only as a detail line: it is never compared or parsed.
class ServerError {
  const ServerError({this.status, this.message});

  final int? status;
  final String? message;

  static ServerError parse(String? raw) {
    if (raw == null || raw.trim().isEmpty) return const ServerError();
    try {
      final decoded = jsonDecode(raw);
      if (decoded is Map) {
        final status = decoded['statusCode'];
        final message = decoded['message'];
        return ServerError(
          status: status is int ? status : null,
          message: switch (message) {
            final String s => s,
            final List<dynamic> list => list.join('; '),
            _ => null,
          },
        );
      }
    } on FormatException {
      // Not JSON: fall through to the upload format.
    }
    final upload = RegExp(r'^(\d{3}): (.*)$', dotAll: true).firstMatch(raw);
    if (upload != null) return ServerError(status: int.parse(upload.group(1)!), message: upload.group(2));
    return ServerError(message: raw);
  }

  /// A localized sentence for the status, or the generic fallback for anything unknown.
  String describe(AppL10n l) => switch (status) {
        400 || 422 => l.serverErrorInvalid,
        401 => l.serverErrorSession,
        403 => l.serverErrorForbidden,
        404 => l.serverErrorNotFound,
        409 => l.serverErrorConflict,
        413 => l.serverErrorTooLarge,
        _ => l.genericError,
      };
}
