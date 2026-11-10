import 'package:flutter/material.dart';

import '../core/l10n.dart';
import '../core/theme/app_theme.dart';

Color statusColor(BuildContext context, String status) {
  final dark = Theme.of(context).brightness == Brightness.dark;
  return switch (status) {
    'OPEN' => dark ? const Color(0xFFA2A9B3) : const Color(0xFF5B6470),
    'SCHEDULED' => dark ? const Color(0xFF7CB6FF) : const Color(0xFF1D5FBF),
    'IN_PROGRESS' => dark ? AppTheme.orangeDark : AppTheme.orange,
    'SIGNATURE_REVIEW' => dark ? const Color(0xFFFFD166) : const Color(0xFF8A5A00),
    'PENDING_APPROVAL' => dark ? const Color(0xFFFFD166) : const Color(0xFF8A5A00),
    'APPROVED' => dark ? const Color(0xFF6FD39B) : const Color(0xFF14703F),
    'CANCELLED' => dark ? const Color(0xFFFF8A80) : const Color(0xFFB42318),
    _ => Theme.of(context).colorScheme.onSurfaceVariant,
  };
}

class StatusChip extends StatelessWidget {
  const StatusChip(this.status, {super.key});
  final String status;

  @override
  Widget build(BuildContext context) {
    final color = statusColor(context, status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        border: Border.all(color: color.withValues(alpha: 0.5)),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(
        statusLabel(context.l10n, status),
        style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w600),
      ),
    );
  }
}

/// Marks a value that exists only on this device and has not been confirmed by the server.
class PendingBadge extends StatelessWidget {
  const PendingBadge({super.key});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Semantics(
      label: context.l10n.pendingBadge,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.cloud_upload_outlined, size: 14, color: scheme.onSurfaceVariant),
          const SizedBox(width: 3),
          Text(
            context.l10n.pendingBadge,
            style: TextStyle(fontSize: 11, color: scheme.onSurfaceVariant, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}

class SectionTitle extends StatelessWidget {
  const SectionTitle(this.text, {super.key, this.trailing});
  final String text;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(0, 20, 0, 8),
      child: Row(
        children: [
          Expanded(
            child: Text(
              text.toUpperCase(),
              style: TextStyle(
                fontSize: 12,
                letterSpacing: 0.8,
                fontWeight: FontWeight.w700,
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
          ),
          ?trailing,
        ],
      ),
    );
  }
}

class KeyValue extends StatelessWidget {
  const KeyValue(this.label, this.value, {super.key, this.mono = false});
  final String label;
  final String value;
  final bool mono;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 96, child: Text(label, style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 13))),
          Expanded(child: Text(value, style: mono ? monoStyle(context) : null)),
        ],
      ),
    );
  }
}

void showMessage(BuildContext context, String text) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(text)));
}