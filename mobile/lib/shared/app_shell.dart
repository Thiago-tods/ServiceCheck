import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/l10n.dart';
import '../features/orders/orders_providers.dart';
import '../features/sync/sync_controller.dart';
import '../features/sync/sync_engine.dart';

class AppShell extends ConsumerWidget {
  const AppShell({super.key, required this.shell});
  final StatefulNavigationShell shell;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    return Scaffold(
      body: Column(
        children: [
          const SyncBanner(),
          Expanded(child: shell),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: shell.currentIndex,
        onDestinationSelected: (i) => shell.goBranch(i, initialLocation: i == shell.currentIndex),
        destinations: [
          NavigationDestination(icon: const Icon(Icons.assignment_outlined), label: l.navOrders),
          NavigationDestination(icon: const Icon(Icons.calendar_month_outlined), label: l.navAgenda),
          NavigationDestination(icon: const Icon(Icons.space_dashboard_outlined), label: l.navDashboard),
          NavigationDestination(icon: const Icon(Icons.tune), label: l.navSettings),
        ],
      ),
    );
  }
}

/// Always tells the truth about what is and is not on the server.
class SyncBanner extends ConsumerWidget {
  const SyncBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final status = ref.watch(syncProvider);
    final pending = ref.watch(pendingCountProvider);
    final issues = ref.watch(syncIssuesProvider).length;
    final scheme = Theme.of(context).colorScheme;

    final (IconData icon, String text, Color color)? info = switch (status.phase) {
      SyncPhase.syncing => (Icons.sync, l.syncSyncing, scheme.primary),
      SyncPhase.offline => (Icons.cloud_off, '${l.syncOffline} · ${l.pendingChanges(pending)}', scheme.onSurfaceVariant),
      SyncPhase.error when pending > 0 => (Icons.error_outline, l.pendingChanges(pending), scheme.error),
      _ when pending > 0 => (Icons.cloud_upload_outlined, l.pendingChanges(pending), scheme.onSurfaceVariant),
      _ when issues > 0 => (Icons.warning_amber_rounded, l.syncIssues, scheme.error),
      _ => null,
    };
    if (info == null) return const SizedBox.shrink();
    return Material(
      color: scheme.surfaceContainerHighest,
      child: SafeArea(
        bottom: false,
        child: InkWell(
          onTap: issues > 0 ? () => context.go('/settings/sync-issues') : () => ref.read(syncProvider.notifier).syncNow(),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              children: [
                Icon(info.$1, size: 16, color: info.$3),
                const SizedBox(width: 8),
                Expanded(child: Text(info.$2, style: TextStyle(fontSize: 12.5, color: info.$3, fontWeight: FontWeight.w600))),
                if (issues > 0) Text(l.syncIssues, style: TextStyle(fontSize: 12, color: scheme.error)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}