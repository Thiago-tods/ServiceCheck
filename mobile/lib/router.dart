import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'features/agenda/agenda_page.dart';
import 'features/auth/auth_controller.dart';
import 'features/auth/company_page.dart';
import 'features/auth/login_page.dart';
import 'features/dashboard/dashboard_page.dart';
import 'features/notifications/notifications_page.dart';
import 'features/orders/execution_page.dart';
import 'features/orders/order_detail_page.dart';
import 'features/orders/orders_page.dart';
import 'features/settings/settings_page.dart';
import 'features/settings/sync_issues_page.dart';
import 'shared/app_shell.dart';

final routerProvider = Provider<GoRouter>((ref) {
  final refresh = ValueNotifier<int>(0);
  ref.listen(authProvider, (_, _) => refresh.value++);
  ref.onDispose(refresh.dispose);

  final router = GoRouter(
    initialLocation: '/orders',
    refreshListenable: refresh,
    redirect: (context, state) {
      final auth = ref.read(authProvider);
      if (auth.isLoading) return null;
      final value = auth.value;
      final at = state.matchedLocation;
      if (value == null || !value.authenticated) return at == '/login' ? null : '/login';
      if (value.companyId == null) return at == '/company' ? null : '/company';
      if (at == '/login' || at == '/company') return '/orders';
      return null;
    },
    routes: [
      GoRoute(path: '/login', builder: (_, _) => const LoginPage()),
      GoRoute(path: '/company', builder: (_, _) => const CompanyPage()),
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => AppShell(shell: shell),
        branches: [
          StatefulShellBranch(routes: [
            GoRoute(
              path: '/orders',
              builder: (_, _) => const OrdersPage(),
              routes: [
                GoRoute(
                  path: ':id',
                  builder: (_, s) => OrderDetailPage(orderId: s.pathParameters['id']!),
                  routes: [
                    GoRoute(
                      path: 'execute',
                      builder: (_, s) => ExecutionPage(orderId: s.pathParameters['id']!),
                    ),
                  ],
                ),
              ],
            ),
          ]),
          StatefulShellBranch(routes: [GoRoute(path: '/agenda', builder: (_, _) => const AgendaPage())]),
          StatefulShellBranch(routes: [GoRoute(path: '/dashboard', builder: (_, _) => const DashboardPage())]),
          StatefulShellBranch(routes: [
            GoRoute(
              path: '/settings',
              builder: (_, _) => const SettingsPage(),
              routes: [
                GoRoute(path: 'sync-issues', builder: (_, _) => const SyncIssuesPage()),
                GoRoute(path: 'notifications', builder: (_, _) => const NotificationsPage()),
              ],
            ),
          ]),
        ],
      ),
    ],
  );
  ref.onDispose(router.dispose);
  return router;
});