import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/l10n.dart';
import 'auth_controller.dart';

class CompanyPage extends ConsumerWidget {
  const CompanyPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final session = ref.watch(authProvider).value?.session;
    final memberships = session?.memberships ?? const [];
    return Scaffold(
      appBar: AppBar(
        title: Text(l.chooseCompany),
        actions: [
          IconButton(
            tooltip: l.signOut,
            icon: const Icon(Icons.logout),
            onPressed: () => ref.read(authProvider.notifier).logout(),
          ),
        ],
      ),
      body: memberships.isEmpty
          ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(l.noCompanies, textAlign: TextAlign.center)))
          : ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: memberships.length,
              separatorBuilder: (_, _) => const SizedBox(height: 8),
              itemBuilder: (context, i) {
                final m = memberships[i];
                return Card(
                  child: ListTile(
                    title: Text(m.companyName),
                    subtitle: Text(roleLabel(l, m.role)),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => ref.read(authProvider.notifier).selectCompany(m.companyId),
                  ),
                );
              },
            ),
    );
  }
}