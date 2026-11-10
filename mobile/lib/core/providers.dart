import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../features/auth/auth_controller.dart';
import 'config/app_config.dart';
import 'db/app_database.dart';
import 'network/api_client.dart';
import 'network/token_store.dart';

final appDatabaseProvider = Provider<AppDatabase>((ref) {
  final db = AppDatabase.open();
  ref.onDispose(db.close);
  return db;
});

final tokenStoreProvider = Provider<TokenStore>((ref) => SecureTokenStore());

final dioProvider = Provider<Dio>((ref) {
  return buildDio(
    baseUrl: AppConfig.apiBaseUrl,
    tokens: ref.watch(tokenStoreProvider),
    // Read lazily: the auth controller itself depends on this client.
    companyId: () => ref.read(authProvider).value?.companyId,
    onSessionExpired: () => ref.read(authProvider.notifier).sessionExpired(),
  );
});