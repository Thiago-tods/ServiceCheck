import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/l10n.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/widgets.dart';
import 'domain/order_view.dart';
import 'orders_providers.dart';

const _filters = ['SCHEDULED', 'IN_PROGRESS', 'SIGNATURE_REVIEW', 'PENDING_APPROVAL', 'APPROVED'];

class OrdersPage extends ConsumerStatefulWidget {
  const OrdersPage({super.key});

  @override
  ConsumerState<OrdersPage> createState() => _OrdersPageState();
}

class _OrdersPageState extends ConsumerState<OrdersPage> {
  String? _filter;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final views = ref.watch(orderViewsProvider);
    return Scaffold(
      appBar: AppBar(title: Text(l.navOrders)),
      body: Column(
        children: [
          SizedBox(
            height: 52,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              children: [
                _chip(l.all, _filter == null, () => setState(() => _filter = null)),
                for (final s in _filters) _chip(statusLabel(l, s), _filter == s, () => setState(() => _filter = s)),
              ],
            ),
          ),
          Expanded(
            child: views.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (e, _) => Center(child: Text(l.genericError)),
              data: (all) {
                final list = _filter == null ? all : all.where((v) => v.status == _filter).toList();
                if (list.isEmpty) return Center(child: Text(l.noOrders));
                return ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
                  itemCount: list.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 8),
                  itemBuilder: (context, i) => OrderTile(view: list[i]),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _chip(String label, bool selected, VoidCallback onTap) {
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: ChoiceChip(label: Text(label), selected: selected, onSelected: (_) => onTap(), showCheckmark: false),
    );
  }
}

class OrderTile extends StatelessWidget {
  const OrderTile({super.key, required this.view});
  final OrderView view;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final order = view.order;
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(6),
        onTap: () => context.go('/orders/${order.id}'),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Text('#${order.number}', style: monoStyle(context, weight: FontWeight.w600)),
                  const SizedBox(width: 10),
                  StatusChip(view.status),
                  const Spacer(),
                  if (view.hasPending) const PendingBadge(),
                  if (view.issueCount > 0) Icon(Icons.warning_amber_rounded, size: 18, color: Theme.of(context).colorScheme.error),
                ],
              ),
              const SizedBox(height: 8),
              Text(order.title, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
              const SizedBox(height: 2),
              Text(
                '${order.clientName} · ${order.addressLine}',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant, fontSize: 13),
              ),
              Semantics(label: l.orderNumber(order.number), child: const SizedBox.shrink()),
            ],
          ),
        ),
      ),
    );
  }
}