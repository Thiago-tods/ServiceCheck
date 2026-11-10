import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/db/app_database.dart';
import '../../core/l10n.dart';
import '../../core/theme/app_theme.dart';
import '../orders/order_actions.dart';
import '../orders/orders_providers.dart';

/// Operations the server refused. Their data is kept here instead of being silently dropped,
/// and the user decides what to do with each one.
class SyncIssuesPage extends ConsumerWidget {
  const SyncIssuesPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final issues = ref.watch(syncIssuesProvider);
    return Scaffold(
      appBar: AppBar(
        title: Text(l.syncIssues),
        leading: BackButton(onPressed: () => context.go('/settings')),
      ),
      body: issues.isEmpty
          ? Center(child: Text(l.syncIssuesEmpty))
          : ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: issues.length,
              separatorBuilder: (_, _) => const SizedBox(height: 8),
              itemBuilder: (context, i) => _IssueCard(op: issues[i]),
            ),
    );
  }
}

String _message(String? raw) {
  if (raw == null) return '';
  try {
    final decoded = jsonDecode(raw);
    if (decoded is Map && decoded['message'] != null) return '${decoded['message']}';
  } on FormatException {
    // plain text error
  }
  return raw;
}

class _IssueCard extends ConsumerWidget {
  const _IssueCard({required this.op});
  final OutboxOp op;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final conflict = op.state == OpState.conflict;
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Icon(Icons.warning_amber_rounded, color: scheme.error, size: 18),
              const SizedBox(width: 8),
              Text(conflict ? l.syncConflict : l.syncRejected, style: TextStyle(color: scheme.error, fontWeight: FontWeight.w600)),
              const Spacer(),
              Text(op.type, style: monoStyle(context, size: 11.5)),
            ]),
            if (_message(op.lastError).isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(_message(op.lastError)),
            ],
            const SizedBox(height: 4),
            Text(op.operationId, style: monoStyle(context, size: 11).copyWith(color: scheme.onSurfaceVariant)),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(onPressed: () => context.go('/orders/${op.orderId}'), child: Text(l.navOrders)),
                TextButton(
                  onPressed: () async {
                    final ok = await showDialog<bool>(
                      context: context,
                      builder: (context) => AlertDialog(
                        content: Text(l.discardConfirm),
                        actions: [
                          TextButton(onPressed: () => Navigator.pop(context, false), child: Text(l.cancel)),
                          FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(l.discard)),
                        ],
                      ),
                    );
                    if (ok == true) await ref.read(orderActionsProvider).discard(op);
                  },
                  child: Text(l.discard),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}