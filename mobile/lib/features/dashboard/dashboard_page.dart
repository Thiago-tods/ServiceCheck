import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/l10n.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/widgets.dart';
import '../orders/orders_providers.dart';

/// Computed from the synced orders on the device, so it works offline.
class DashboardPage extends ConsumerWidget {
  const DashboardPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final views = ref.watch(orderViewsProvider).value ?? const [];
    final counts = <String, int>{};
    for (final v in views) {
      counts[v.status] = (counts[v.status] ?? 0) + 1;
    }
    final now = DateTime.now();
    final today = views.where((v) {
      if (v.status == 'CANCELLED') return false;
      return v.order.activeAssignments.any((a) {
        final s = a.startsAt.toLocal();
        return s.year == now.year && s.month == now.month && s.day == now.day;
      });
    }).length;
    final attention = (counts['SIGNATURE_REVIEW'] ?? 0) + (counts['PENDING_APPROVAL'] ?? 0);
    const statuses = ['OPEN', 'SCHEDULED', 'IN_PROGRESS', 'SIGNATURE_REVIEW', 'PENDING_APPROVAL', 'APPROVED', 'CANCELLED'];

    return Scaffold(
      appBar: AppBar(title: Text(l.navDashboard)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Row(
            children: [
              Expanded(child: _Metric(label: l.scheduledToday, value: today)),
              const SizedBox(width: 12),
              Expanded(child: _Metric(label: l.needsAttention, value: attention, highlight: attention > 0)),
            ],
          ),
          SectionTitle(l.byStatus),
          Card(
            child: Column(
              children: [
                for (final s in statuses)
                  ListTile(
                    dense: true,
                    leading: Container(width: 6, height: 28, color: statusColor(context, s)),
                    title: Text(statusLabel(l, s)),
                    trailing: Text('${counts[s] ?? 0}', style: monoStyle(context, size: 15, weight: FontWeight.w600)),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Metric extends StatelessWidget {
  const _Metric({required this.label, required this.value, this.highlight = false});
  final String label;
  final int value;
  final bool highlight;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('$value', style: monoStyle(context, size: 32, weight: FontWeight.w600).copyWith(color: highlight ? scheme.primary : null)),
            const SizedBox(height: 4),
            Text(label, style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 13)),
          ],
        ),
      ),
    );
  }
}