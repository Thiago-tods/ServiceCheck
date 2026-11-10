import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/l10n.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/widgets.dart';
import '../auth/auth_controller.dart';
import '../orders/domain/order_view.dart';
import '../orders/orders_providers.dart';

class _Slot {
  const _Slot(this.start, this.end, this.view);
  final DateTime start;
  final DateTime end;
  final OrderView view;
}

class AgendaPage extends ConsumerWidget {
  const AgendaPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final me = ref.watch(authProvider).value?.membership;
    final views = ref.watch(orderViewsProvider).value ?? const [];
    final locale = Localizations.localeOf(context).toString();

    final slots = <_Slot>[];
    for (final v in views) {
      if (v.status == 'CANCELLED' || me == null) continue;
      final a = v.order.assignmentOf(me.membershipId);
      if (a != null) slots.add(_Slot(a.startsAt.toLocal(), a.endsAt.toLocal(), v));
    }
    slots.sort((a, b) => a.start.compareTo(b.start));

    final byDay = <DateTime, List<_Slot>>{};
    for (final s in slots) {
      byDay.putIfAbsent(DateTime(s.start.year, s.start.month, s.start.day), () => []).add(s);
    }
    final days = byDay.keys.toList()..sort();
    final timeFmt = DateFormat.Hm(locale);

    return Scaffold(
      appBar: AppBar(title: Text(l.navAgenda)),
      body: days.isEmpty
          ? Center(child: Text(l.noAgenda))
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                for (final day in days) ...[
                  SectionTitle(DateFormat.yMMMEd(locale).format(day)),
                  for (final s in byDay[day]!)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Card(
                        child: ListTile(
                          onTap: () => context.go('/orders/${s.view.order.id}'),
                          leading: Text(
                            '${timeFmt.format(s.start)}\n${timeFmt.format(s.end)}',
                            style: monoStyle(context, size: 12.5),
                          ),
                          title: Text(s.view.order.title),
                          subtitle: Text(s.view.order.clientName),
                          trailing: StatusChip(s.view.status),
                        ),
                      ),
                    ),
                ],
              ],
            ),
    );
  }
}