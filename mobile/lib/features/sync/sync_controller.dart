import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../auth/auth_controller.dart';
import 'sync_api.dart';
import 'sync_engine.dart';

final syncProvider = NotifierProvider<SyncController, SyncStatus>(SyncController.new);

/// Keeps one [SyncEngine] per selected company and decides when to run it:
/// at start, when connectivity returns, periodically, and shortly after each local change.
class SyncController extends Notifier<SyncStatus> {
  SyncEngine? _engine;
  Timer? _debounce;

  @override
  SyncStatus build() {
    final companyId = ref.watch(authProvider.select((a) => a.value?.companyId));
    _engine = null;
    if (companyId == null) return const SyncStatus();

    final engine = SyncEngine(
      db: ref.read(appDatabaseProvider),
      api: DioSyncApi(ref.read(dioProvider)),
      companyId: companyId,
      onStatus: (s) => state = s,
    );
    _engine = engine;

    final connectivity = Connectivity().onConnectivityChanged.listen((results) {
      if (results.any((r) => r != ConnectivityResult.none)) unawaited(syncNow());
    });
    final timer = Timer.periodic(const Duration(seconds: 60), (_) => unawaited(syncNow()));
    ref.onDispose(() {
      unawaited(connectivity.cancel());
      timer.cancel();
      _debounce?.cancel();
    });
    Future<void>.microtask(syncNow);
    return const SyncStatus();
  }

  Future<void> syncNow() async {
    final engine = _engine;
    if (engine == null) return;
    await engine.syncNow();
  }

  /// Called after a local change: batches rapid edits into a single sync.
  void requestSync() {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 800), () => unawaited(syncNow()));
  }
}