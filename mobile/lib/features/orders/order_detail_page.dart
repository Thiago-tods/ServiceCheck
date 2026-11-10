import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/l10n.dart';
import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/widgets.dart';
import '../auth/auth_controller.dart';
import 'domain/order_view.dart';
import 'order_actions.dart';
import 'orders_providers.dart';

class OrderDetailPage extends ConsumerWidget {
  const OrderDetailPage({super.key, required this.orderId});
  final String orderId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final view = ref.watch(orderViewProvider(orderId));
    final auth = ref.watch(authProvider).value;
    final me = auth?.membership;
    if (view == null) {
      return Scaffold(appBar: AppBar(), body: Center(child: Text(l.genericError)));
    }
    final order = view.order;
    final mine = me != null && order.assignmentOf(me.membershipId) != null;
    final exec = view.execution;
    final wasParticipant = me != null &&
        order.executions.any((e) => e.participants.any((p) => p.membershipId == me.membershipId));
    final reopened = order.executions.where((e) => e.status == 'PENDING').firstOrNull;

    return Scaffold(
      appBar: AppBar(title: Text(l.orderNumber(order.number), style: monoStyle(context, size: 17, weight: FontWeight.w600))),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Row(
            children: [
              StatusChip(view.status),
              const SizedBox(width: 10),
              if (view.statusPending) const PendingBadge(),
            ],
          ),
          const SizedBox(height: 12),
          Text(order.title, style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w600)),
          if (order.description != null) ...[
            const SizedBox(height: 6),
            Text(order.description!),
          ],
          if (reopened != null && reopened.reopenReason != null) ...[
            const SizedBox(height: 12),
            Card(
              child: ListTile(
                leading: const Icon(Icons.replay),
                title: Text(l.reopenedNotice),
                subtitle: Text(reopened.reopenReason!),
              ),
            ),
          ],
          SectionTitle(l.client),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  KeyValue(l.client, order.clientName),
                  KeyValue(l.address, order.addressLine),
                ],
              ),
            ),
          ),
          SectionTitle(l.service),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  KeyValue(l.service, order.serviceName ?? '-'),
                  if (order.checklistVersion != null) KeyValue(l.checklist, l.checklistVersion(order.checklistVersion!)),
                ],
              ),
            ),
          ),
          if (exec != null) ...[
            SectionTitle(l.checklist),
            Card(
              child: Column(
                children: [
                  for (final i in exec.items)
                    ListTile(
                      dense: true,
                      leading: Icon(i.item.done ? Icons.check_box : Icons.check_box_outline_blank, color: i.item.done ? Theme.of(context).colorScheme.primary : null),
                      title: Text(i.item.label),
                      subtitle: i.item.value == null ? null : Text(i.item.value!),
                      trailing: i.pending ? const PendingBadge() : null,
                    ),
                ],
              ),
            ),
            if (exec.signature != null) ...[
              SectionTitle(l.signature),
              Card(
                child: ListTile(
                  leading: const Icon(Icons.draw_outlined),
                  title: Text(_signatureLabel(l, exec.signature!.status)),
                  subtitle: Text(exec.signature!.signerName ?? exec.signature!.reason ?? ''),
                  trailing: exec.signature!.pending ? const PendingBadge() : null,
                ),
              ),
            ],
            if (exec.notes.isNotEmpty) ...[
              SectionTitle(l.notes),
              for (final n in exec.notes)
                Card(
                  child: ListTile(
                    title: Text(n.text),
                    trailing: n.pending ? const PendingBadge() : null,
                  ),
                ),
            ],
          ],
          const SizedBox(height: 24),
          if (view.status == 'SCHEDULED' && mine)
            FilledButton.icon(
              icon: const Icon(Icons.play_arrow),
              label: Text(l.startExecution),
              onPressed: () async {
                await ref.read(orderActionsProvider).startExecution(view);
                if (context.mounted) context.go('/orders/$orderId/execute');
              },
            ),
          if (view.status == 'IN_PROGRESS' && (mine || wasParticipant))
            FilledButton.icon(
              icon: const Icon(Icons.edit_note),
              label: Text(l.checklist),
              onPressed: () => context.go('/orders/$orderId/execute'),
            ),
          if (me != null && me.isManager) ..._managerActions(context, ref, view, wasParticipant),
        ],
      ),
    );
  }

  List<Widget> _managerActions(BuildContext context, WidgetRef ref, OrderView view, bool wasParticipant) {
    final l = context.l10n;
    Future<void> run(Future<void> Function() action) async {
      try {
        await action();
      } on OfflineException {
        if (context.mounted) showMessage(context, l.onlineOnly);
      } catch (_) {
        if (context.mounted) showMessage(context, l.genericError);
      }
    }

    if (view.status == 'PENDING_APPROVAL' && !wasParticipant) {
      return [
        FilledButton.icon(
          icon: const Icon(Icons.verified_outlined),
          label: Text(l.approve),
          onPressed: () => run(() => ref.read(orderActionsProvider).approve(view.order.id)),
        ),
      ];
    }
    if (view.status == 'SIGNATURE_REVIEW') {
      return [
        FilledButton(
          onPressed: () async {
            final note = await _askNote(context, l.reviewAccept);
            if (note != null) await run(() => ref.read(orderActionsProvider).reviewSignature(view.order.id, accept: true, note: note));
          },
          child: Text(l.reviewAccept),
        ),
        const SizedBox(height: 8),
        OutlinedButton(
          onPressed: () async {
            final note = await _askNote(context, l.reviewReturn);
            if (note != null) await run(() => ref.read(orderActionsProvider).reviewSignature(view.order.id, accept: false, note: note));
          },
          child: Text(l.reviewReturn),
        ),
      ];
    }
    return const [];
  }
}

String _signatureLabel(AppL10n l, String status) => switch (status) {
      'SIGNED' => l.signatureSigned,
      'REFUSED' => l.signatureRefused,
      _ => l.signatureAbsent,
    };

Future<String?> _askNote(BuildContext context, String title) {
  final controller = TextEditingController();
  final l = context.l10n;
  return showDialog<String>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: TextField(controller: controller, autofocus: true, decoration: InputDecoration(labelText: l.reviewNote), minLines: 2, maxLines: 4),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: Text(l.cancel)),
        FilledButton(
          onPressed: () {
            final text = controller.text.trim();
            if (text.length >= 3) Navigator.pop(context, text);
          },
          child: Text(l.confirm),
        ),
      ],
    ),
  );
}