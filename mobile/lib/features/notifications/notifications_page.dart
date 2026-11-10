import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/l10n.dart';
import '../../core/network/api_client.dart';
import '../../core/providers.dart';
import '../../shared/widgets.dart';

final notificationsProvider = FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  try {
    final res = await ref.read(dioProvider).get<List<dynamic>>('/notifications');
    return res.data!.cast<Map<String, dynamic>>();
  } on DioException catch (e) {
    if (isOfflineError(e)) throw const OfflineException();
    rethrow;
  }
});

class NotificationsPage extends ConsumerWidget {
  const NotificationsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final items = ref.watch(notificationsProvider);
    return Scaffold(
      appBar: AppBar(
        title: Text(l.notifications),
        actions: [
          IconButton(
            tooltip: l.markAllRead,
            icon: const Icon(Icons.done_all),
            onPressed: () async {
              try {
                await ref.read(dioProvider).post<Object?>('/notifications/read-all');
                ref.invalidate(notificationsProvider);
              } on DioException {
                if (context.mounted) showMessage(context, l.networkError);
              }
            },
          ),
        ],
      ),
      body: items.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text(e is OfflineException ? l.networkError : l.genericError)),
        data: (list) => list.isEmpty
            ? Center(child: Text(l.noNotifications))
            : ListView.separated(
                itemCount: list.length,
                separatorBuilder: (_, _) => const Divider(),
                itemBuilder: (context, i) {
                  final n = list[i];
                  final unread = n['readAt'] == null;
                  return ListTile(
                    leading: Icon(unread ? Icons.circle : Icons.circle_outlined, size: 12, color: unread ? Theme.of(context).colorScheme.primary : null),
                    title: Text(n['title'] as String, style: TextStyle(fontWeight: unread ? FontWeight.w600 : FontWeight.w400)),
                    onTap: n['entityType'] == 'WorkOrder' ? () => context.go('/orders/${n['entityId']}') : null,
                  );
                },
              ),
      ),
    );
  }
}