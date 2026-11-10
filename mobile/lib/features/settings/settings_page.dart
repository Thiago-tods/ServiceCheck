import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/l10n.dart';
import '../../core/prefs/prefs_controller.dart';
import '../../shared/widgets.dart';
import '../auth/auth_controller.dart';
import '../orders/orders_providers.dart';
import '../sync/sync_controller.dart';
import '../sync/sync_engine.dart';

class SettingsPage extends ConsumerWidget {
  const SettingsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final auth = ref.watch(authProvider).value;
    final prefs = ref.watch(prefsProvider);
    final sync = ref.watch(syncProvider);
    final pending = ref.watch(pendingCountProvider);
    final issues = ref.watch(syncIssuesProvider).length;
    final locale = Localizations.localeOf(context).toString();
    final membership = auth?.membership;

    return Scaffold(
      appBar: AppBar(title: Text(l.navSettings)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: ListTile(
              leading: const Icon(Icons.person_outline),
              title: Text(auth?.session?.name ?? ''),
              subtitle: Text('${auth?.session?.email ?? ''}\n${membership == null ? '' : '${membership.companyName} · ${roleLabel(l, membership.role)}'}'),
              isThreeLine: true,
            ),
          ),
          if ((auth?.session?.memberships.length ?? 0) > 1)
            Card(
              child: ListTile(
                leading: const Icon(Icons.swap_horiz),
                title: Text(l.chooseCompany),
                trailing: const Icon(Icons.chevron_right),
                onTap: () async {
                  final id = await showDialog<String>(
                    context: context,
                    builder: (context) => SimpleDialog(
                      title: Text(l.chooseCompany),
                      children: [
                        for (final m in auth!.session!.memberships)
                          SimpleDialogOption(
                            onPressed: () => Navigator.pop(context, m.companyId),
                            child: Text('${m.companyName} · ${roleLabel(l, m.role)}'),
                          ),
                      ],
                    ),
                  );
                  if (id != null) await ref.read(authProvider.notifier).selectCompany(id);
                },
              ),
            ),
          SectionTitle(l.syncNow),
          Card(
            child: Column(
              children: [
                ListTile(
                  leading: Icon(switch (sync.phase) {
                    SyncPhase.syncing => Icons.sync,
                    SyncPhase.offline => Icons.cloud_off,
                    SyncPhase.error => Icons.error_outline,
                    SyncPhase.idle => pending > 0 ? Icons.cloud_upload_outlined : Icons.cloud_done_outlined,
                  }),
                  title: Text(switch (sync.phase) {
                    SyncPhase.syncing => l.syncSyncing,
                    SyncPhase.offline => l.syncOffline,
                    SyncPhase.error => l.genericError,
                    SyncPhase.idle => pending > 0 ? l.syncPending : l.syncSynced,
                  }),
                  subtitle: Text(
                    '${l.pendingChanges(pending)}\n${l.lastSync}: ${sync.lastSyncAt == null ? l.never : DateFormat.yMd(locale).add_Hm().format(sync.lastSyncAt!)}',
                  ),
                  isThreeLine: true,
                  trailing: IconButton(
                    tooltip: l.syncNow,
                    icon: const Icon(Icons.refresh),
                    onPressed: sync.phase == SyncPhase.syncing ? null : () => ref.read(syncProvider.notifier).syncNow(),
                  ),
                ),
                const Divider(),
                ListTile(
                  leading: Icon(Icons.warning_amber_rounded, color: issues > 0 ? Theme.of(context).colorScheme.error : null),
                  title: Text(l.syncIssues),
                  trailing: Text('$issues'),
                  onTap: () => context.go('/settings/sync-issues'),
                ),
              ],
            ),
          ),
          Card(
            child: ListTile(
              leading: const Icon(Icons.notifications_none),
              title: Text(l.notifications),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.go('/settings/notifications'),
            ),
          ),
          SectionTitle(l.appearance),
          SegmentedButton<ThemeMode>(
            segments: [
              ButtonSegment(value: ThemeMode.system, label: Text(l.themeSystem)),
              ButtonSegment(value: ThemeMode.light, label: Text(l.themeLight)),
              ButtonSegment(value: ThemeMode.dark, label: Text(l.themeDark)),
            ],
            selected: {prefs.themeMode},
            onSelectionChanged: (s) => ref.read(prefsProvider.notifier).setThemeMode(s.first),
          ),
          SectionTitle(l.language),
          SegmentedButton<String>(
            segments: [
              ButtonSegment(value: 'system', label: Text(l.themeSystem)),
              const ButtonSegment(value: 'pt_BR', label: Text('Português')),
              const ButtonSegment(value: 'en', label: Text('English')),
            ],
            selected: {
              switch (prefs.locale) {
                null => 'system',
                final loc when loc.languageCode == 'pt' => 'pt_BR',
                _ => 'en',
              },
            },
            onSelectionChanged: (s) => ref.read(prefsProvider.notifier).setLocale(switch (s.first) {
              'pt_BR' => const Locale('pt', 'BR'),
              'en' => const Locale('en'),
              _ => null,
            }),
          ),
          const SizedBox(height: 32),
          OutlinedButton.icon(
            icon: const Icon(Icons.logout),
            label: Text(l.signOut),
            onPressed: () => _confirmSignOut(context, ref, pending + issues),
          ),
        ],
      ),
    );
  }

  Future<void> _confirmSignOut(BuildContext context, WidgetRef ref, int unsynced) async {
    final l = context.l10n;
    if (unsynced > 0) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(l.signOut),
          content: Text(l.signOutWarning(unsynced)),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: Text(l.cancel)),
            FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(l.signOut)),
          ],
        ),
      );
      if (ok != true) return;
    }
    await ref.read(authProvider.notifier).logout();
  }
}