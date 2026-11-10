import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/l10n.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/signature_pad.dart';
import '../../shared/widgets.dart';
import '../auth/auth_controller.dart';
import 'domain/order_view.dart';
import 'order_actions.dart';
import 'orders_providers.dart';

class ExecutionPage extends ConsumerStatefulWidget {
  const ExecutionPage({super.key, required this.orderId});
  final String orderId;

  @override
  ConsumerState<ExecutionPage> createState() => _ExecutionPageState();
}

class _ExecutionPageState extends ConsumerState<ExecutionPage> {
  final _note = TextEditingController();

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _pick(OrderView view, ImageSource source, {int? itemPosition}) async {
    final file = await ImagePicker().pickImage(source: source, imageQuality: 80, maxWidth: 1920);
    if (file == null) return;
    await ref.read(orderActionsProvider).attachPhoto(view, file.path, itemPosition: itemPosition);
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final view = ref.watch(orderViewProvider(widget.orderId));
    final exec = view?.execution;
    if (view == null) {
      return Scaffold(appBar: AppBar(), body: Center(child: Text(l.genericError)));
    }
    if (exec == null) return _ExecutionUnavailable(view: view);
    final actions = ref.read(orderActionsProvider);
    final editable = exec.status == 'IN_PROGRESS';
    final me = ref.watch(authProvider).value?.membership;
    final lead = _isLead(view, me?.membershipId);
    final canFinish = editable && lead && exec.requiredDone && exec.hasSignatureStep;

    return Scaffold(
      appBar: AppBar(
        title: Text(l.orderNumber(view.order.number), style: monoStyle(context, size: 17, weight: FontWeight.w600)),
        leading: BackButton(onPressed: () => context.go('/orders/${widget.orderId}')),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Row(children: [
            StatusChip(view.status),
            const SizedBox(width: 10),
            if (view.statusPending) const PendingBadge(),
            const Spacer(),
            Icon(Icons.save_outlined, size: 14, color: Theme.of(context).colorScheme.onSurfaceVariant),
            const SizedBox(width: 4),
            Text(l.localState, style: TextStyle(fontSize: 11.5, color: Theme.of(context).colorScheme.onSurfaceVariant)),
          ]),
          SectionTitle(l.checklist),
          Card(
            child: Column(
              children: [
                for (final i in exec.items) ...[
                  _ItemTile(
                    key: ValueKey('item-${i.item.position}'),
                    item: i,
                    enabled: editable,
                    onDone: (v) => actions.setItem(view, i, done: v),
                    onValue: (v) => actions.setItem(view, i, value: v),
                    onPhoto: () => _pick(view, ImageSource.camera, itemPosition: i.item.position),
                  ),
                  if (i != exec.items.last) const Divider(),
                ],
              ],
            ),
          ),
          SectionTitle(l.notes),
          for (final n in exec.notes)
            Card(
              child: ListTile(title: Text(n.text), trailing: n.pending ? const PendingBadge() : null),
            ),
          if (editable) ...[
            const SizedBox(height: 8),
            TextField(
              key: const Key('note-field'),
              controller: _note,
              minLines: 1,
              maxLines: 4,
              decoration: InputDecoration(
                hintText: l.noteHint,
                suffixIcon: IconButton(
                  key: const Key('note-add'),
                  tooltip: l.addNote,
                  icon: const Icon(Icons.send),
                  onPressed: () async {
                    final text = _note.text.trim();
                    if (text.isEmpty) return;
                    _note.clear();
                    await actions.addNote(view, text);
                  },
                ),
              ),
            ),
          ],
          SectionTitle(
            l.photos,
            trailing: editable
                ? Row(children: [
                    IconButton(tooltip: l.takePhoto, icon: const Icon(Icons.photo_camera_outlined), onPressed: () => _pick(view, ImageSource.camera)),
                    IconButton(tooltip: l.pickPhoto, icon: const Icon(Icons.photo_library_outlined), onPressed: () => _pick(view, ImageSource.gallery)),
                  ])
                : null,
          ),
          for (final a in exec.attachments)
            Card(child: ListTile(dense: true, leading: const Icon(Icons.image_outlined), title: Text(a.filename), trailing: a.pending ? const PendingBadge() : null)),
          SectionTitle(l.signature),
          _SignatureCard(view: view, editable: editable && lead),
          const SizedBox(height: 24),
          if (editable)
            FilledButton.icon(
              key: const Key('finish-button'),
              icon: const Icon(Icons.flag_outlined),
              label: Text(l.finishExecution),
              onPressed: canFinish
                  ? () async {
                      await actions.finish(view);
                      if (context.mounted) context.go('/orders/${widget.orderId}');
                    }
                  : null,
            ),
          if (editable && !canFinish)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                !exec.requiredDone ? l.requiredPending : (!exec.hasSignatureStep ? l.signatureMissing : ''),
                style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant, fontSize: 13),
              ),
            ),
        ],
      ),
    );
  }

  /// Only the lead technician signs and finishes (the server enforces it too).
  bool _isLead(OrderView view, String? membershipId) {
    if (membershipId == null) return false;
    final serverExec = view.order.executions.where((e) => e.id == view.execution!.id).firstOrNull;
    if (serverExec != null) {
      final active = serverExec.participants.where((p) => p.active && p.isPrimary).firstOrNull;
      if (active != null) return active.membershipId == membershipId;
    }
    return view.order.activeAssignments.where((a) => a.isPrimary).firstOrNull?.membershipId == membershipId;
  }
}

class _ItemTile extends StatelessWidget {
  const _ItemTile({
    super.key,
    required this.item,
    required this.enabled,
    required this.onDone,
    required this.onValue,
    required this.onPhoto,
  });

  final ItemView item;
  final bool enabled;
  final ValueChanged<bool> onDone;
  final ValueChanged<String> onValue;
  final VoidCallback onPhoto;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final i = item.item;
    final title = Row(
      children: [
        Expanded(child: Text(i.label)),
        if (i.required) Text(' · ${l.required}', style: TextStyle(fontSize: 11.5, color: Theme.of(context).colorScheme.onSurfaceVariant)),
        if (item.pending) ...[const SizedBox(width: 8), const PendingBadge()],
      ],
    );
    switch (i.kind) {
      case 'TEXT':
      case 'NUMBER':
        return Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              title,
              const SizedBox(height: 8),
              _ValueField(
                initial: i.value ?? '',
                enabled: enabled,
                numeric: i.kind == 'NUMBER',
                onCommit: onValue,
              ),
            ],
          ),
        );
      case 'PHOTO':
        return ListTile(
          title: title,
          leading: Icon(i.done ? Icons.check_circle : Icons.photo_camera_outlined, color: i.done ? Theme.of(context).colorScheme.primary : null),
          trailing: enabled ? IconButton(tooltip: l.takePhoto, icon: const Icon(Icons.add_a_photo_outlined), onPressed: onPhoto) : null,
        );
      default:
        return CheckboxListTile(
          value: i.done,
          onChanged: enabled ? (v) => onDone(v ?? false) : null,
          title: title,
          controlAffinity: ListTileControlAffinity.leading,
        );
    }
  }
}

/// Commits when the field loses focus or the user submits, not on every keystroke.
class _ValueField extends StatefulWidget {
  const _ValueField({required this.initial, required this.enabled, required this.numeric, required this.onCommit});
  final String initial;
  final bool enabled;
  final bool numeric;
  final ValueChanged<String> onCommit;

  @override
  State<_ValueField> createState() => _ValueFieldState();
}

class _ValueFieldState extends State<_ValueField> {
  late final TextEditingController _c = TextEditingController(text: widget.initial);
  final _focus = FocusNode();
  late String _committed = widget.initial;

  @override
  void initState() {
    super.initState();
    _focus.addListener(() {
      if (!_focus.hasFocus) _commit();
    });
  }

  @override
  void didUpdateWidget(_ValueField old) {
    super.didUpdateWidget(old);
    if (!_focus.hasFocus && widget.initial != _committed) {
      _c.text = widget.initial;
      _committed = widget.initial;
    }
  }

  void _commit() {
    final text = _c.text.trim();
    if (text == _committed) return;
    _committed = text;
    widget.onCommit(text);
  }

  @override
  void dispose() {
    _c.dispose();
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: _c,
      focusNode: _focus,
      enabled: widget.enabled,
      keyboardType: widget.numeric ? const TextInputType.numberWithOptions(decimal: true) : TextInputType.text,
      style: widget.numeric ? monoStyle(context) : null,
      onSubmitted: (_) => _commit(),
    );
  }
}

class _SignatureCard extends ConsumerWidget {
  const _SignatureCard({required this.view, required this.editable});
  final OrderView view;
  final bool editable;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final sig = view.execution!.signature;
    return Card(
      child: ListTile(
        leading: Icon(sig == null ? Icons.draw_outlined : Icons.check_circle, color: sig == null ? null : Theme.of(context).colorScheme.primary),
        title: Text(switch (sig?.status) {
          'SIGNED' => '${l.signatureSigned}: ${sig!.signerName ?? ''}',
          'REFUSED' => l.signatureRefused,
          'ABSENT' => l.signatureAbsent,
          _ => l.signature,
        }),
        subtitle: sig?.reason == null ? null : Text(sig!.reason!),
        trailing: sig?.pending == true ? const PendingBadge() : null,
        onTap: editable ? () => _open(context, ref) : null,
      ),
    );
  }

  Future<void> _open(BuildContext context, WidgetRef ref) async {
    // Otherwise the note field (still focused after sending a note) takes focus back when the
    // sheet closes and brings the keyboard up again.
    FocusManager.instance.primaryFocus?.unfocus();
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) => _SignatureSheet(view: view),
    );
  }
}

/// The server has no execution to show for this order (for example a locally started execution
/// was rejected because the order was cancelled). Nothing local is presented as confirmed.
class _ExecutionUnavailable extends ConsumerWidget {
  const _ExecutionUnavailable({required this.view});
  final OrderView view;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final scheme = Theme.of(context).colorScheme;
    final hasIssues = ref.watch(syncIssuesProvider).isNotEmpty;
    return Scaffold(
      appBar: AppBar(
        title: Text(l.orderNumber(view.order.number), style: monoStyle(context, size: 17, weight: FontWeight.w600)),
        leading: BackButton(onPressed: () => context.go('/orders')),
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.report_gmailerrorred_outlined, size: 36, color: scheme.error),
              const SizedBox(height: 12),
              Text(l.executionUnavailableTitle, style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              Text(
                view.status == 'CANCELLED' ? l.executionCancelled : l.executionUnavailable,
                key: const Key('execution-unavailable-message'),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 20),
              FilledButton(
                key: const Key('back-to-orders'),
                onPressed: () => context.go('/orders'),
                child: Text(l.backToOrders),
              ),
              if (hasIssues)
                TextButton(
                  key: const Key('open-sync-issues'),
                  onPressed: () => context.go('/settings/sync-issues'),
                  child: Text(l.syncIssues),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SignatureSheet extends ConsumerStatefulWidget {
  const _SignatureSheet({required this.view});
  final OrderView view;

  @override
  ConsumerState<_SignatureSheet> createState() => _SignatureSheetState();
}

class _SignatureSheetState extends ConsumerState<_SignatureSheet> {
  final _pad = SignatureController();
  final _name = TextEditingController();
  final _reason = TextEditingController();
  String _mode = 'SIGNED';

  @override
  void dispose() {
    _pad.dispose();
    _name.dispose();
    _reason.dispose();
    super.dispose();
  }

  bool get _valid => _mode == 'SIGNED'
      ? _name.text.trim().length >= 2 && !_pad.isEmpty
      : _reason.text.trim().length >= 3;

  Future<void> _save() async {
    final actions = ref.read(orderActionsProvider);
    if (_mode == 'SIGNED') {
      final png = await _pad.toPng();
      await actions.setSignature(widget.view, status: 'SIGNED', signerName: _name.text.trim(), imagePngBase64: base64Encode(png));
    } else {
      await actions.setSignature(widget.view, status: _mode, reason: _reason.text.trim());
    }
    if (mounted) Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, 16 + MediaQuery.of(context).viewInsets.bottom),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            SegmentedButton<String>(
              segments: [
                ButtonSegment(value: 'SIGNED', label: Text(l.signatureSigned)),
                ButtonSegment(value: 'REFUSED', label: Text(l.signatureRefused)),
                ButtonSegment(value: 'ABSENT', label: Text(l.signatureAbsent)),
              ],
              selected: {_mode},
              onSelectionChanged: (s) => setState(() => _mode = s.first),
            ),
            const SizedBox(height: 16),
            if (_mode == 'SIGNED') ...[
              TextField(
                key: const Key('signer-name'),
                controller: _name,
                decoration: InputDecoration(labelText: l.signerName),
                onChanged: (_) => setState(() {}),
              ),
              const SizedBox(height: 12),
              SignaturePad(controller: _pad),
              ListenableBuilder(
                listenable: _pad,
                builder: (context, _) => Align(
                  alignment: Alignment.centerRight,
                  child: TextButton(onPressed: _pad.isEmpty ? null : _pad.clear, child: Text(l.clear)),
                ),
              ),
            ] else
              TextField(
                key: const Key('signature-reason'),
                controller: _reason,
                decoration: InputDecoration(labelText: l.signatureReason),
                minLines: 2,
                maxLines: 4,
                onChanged: (_) => setState(() {}),
              ),
            const SizedBox(height: 8),
            ListenableBuilder(
              listenable: _pad,
              builder: (context, _) => FilledButton(
                key: const Key('signature-save'),
                onPressed: _valid ? _save : null,
                child: Text(l.saveSignature),
              ),
            ),
          ],
        ),
      ),
    );
  }
}