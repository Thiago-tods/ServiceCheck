import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:servicecheck/core/db/app_database.dart';
import 'package:servicecheck/core/l10n.dart';
import 'package:servicecheck/core/network/token_store.dart';
import 'package:servicecheck/core/providers.dart';
import 'package:servicecheck/core/theme/app_theme.dart';
import 'package:servicecheck/features/auth/auth_controller.dart';
import 'package:servicecheck/features/auth/login_page.dart';
import 'package:servicecheck/features/auth/session.dart';
import 'package:servicecheck/features/orders/execution_page.dart';
import 'package:servicecheck/features/orders/order_detail_page.dart';
import 'package:servicecheck/features/orders/orders_page.dart';
import 'package:servicecheck/features/sync/sync_controller.dart';
import 'package:servicecheck/features/sync/sync_engine.dart';
import 'package:servicecheck/shared/signature_pad.dart';

import 'support/fixtures.dart';

/// Widget tests must not start the real engine (network, connectivity plugin, timers).
class NoopSync extends SyncController {
  int requests = 0;

  @override
  SyncStatus build() => const SyncStatus();

  @override
  Future<void> syncNow() async {}

  @override
  void requestSync() => requests++;
}

class FakeAuth extends AuthController {
  FakeAuth(this.initial, [this.onLogin]);
  final AuthState initial;
  final Future<void> Function(String, String)? onLogin;

  @override
  Future<AuthState> build() async => initial;

  @override
  Future<void> login(String email, String password) async => onLogin?.call(email, password);
}

final session = Session(
  userId: 'u1',
  name: 'Técnico Teste',
  email: 't@example.com',
  memberships: const [
    Membership(membershipId: me, companyId: company, companyName: 'Acme', role: 'PROFESSIONAL'),
  ],
);

Widget harness({
  required AppDatabase db,
  required Widget home,
  AuthState? auth,
  Future<void> Function(String, String)? onLogin,
  Locale locale = const Locale('en'),
}) {
  final router = GoRouter(
    routes: [
      GoRoute(path: '/', builder: (_, _) => home),
      GoRoute(path: '/orders/:id', builder: (_, s) => OrderDetailPage(orderId: s.pathParameters['id']!)),
      GoRoute(path: '/orders/:id/execute', builder: (_, s) => ExecutionPage(orderId: s.pathParameters['id']!)),
    ],
  );
  return ProviderScope(
    overrides: [
      appDatabaseProvider.overrideWithValue(db),
      tokenStoreProvider.overrideWithValue(MemoryTokenStore()),
      syncProvider.overrideWith(NoopSync.new),
      authProvider.overrideWith(() => FakeAuth(auth ?? AuthState(session: session, companyId: company), onLogin)),
    ],
    child: MaterialApp.router(
      theme: AppTheme.light,
      locale: locale,
      supportedLocales: AppL10n.supportedLocales,
      localizationsDelegates: const [
        AppL10n.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      routerConfig: router,
    ),
  );
}

void main() {
  const orderId = 'o0000000-0000-4000-8000-000000000001';
  late AppDatabase db;

  setUp(() => db = memoryDb());

  Future<void> disposeAll(WidgetTester tester) async {
    await tester.pumpWidget(const SizedBox());
    // Drift cancels watched queries with a zero-length timer; the fake clock must run it first.
    await tester.pump(const Duration(seconds: 1));
    await tester.runAsync(db.close);
  }

  testWidgets('login validates input and shows a friendly error for bad credentials', (tester) async {
    await tester.pumpWidget(
      harness(
        db: db,
        home: const LoginPage(),
        auth: AuthState.signedOut,
        onLogin: (_, _) async => throw const InvalidCredentials(),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byType(FilledButton));
    await tester.pump();
    expect(find.text('Required'), findsNWidgets(2));

    await tester.enterText(find.byType(TextFormField).first, 'a@b.com');
    await tester.enterText(find.byType(TextFormField).last, 'wrong');
    await tester.tap(find.byType(FilledButton));
    await tester.pumpAndSettle();
    expect(find.text('Invalid e-mail or password.'), findsOneWidget);
    await disposeAll(tester);
  });

  testWidgets('login is available in Brazilian Portuguese', (tester) async {
    await tester.pumpWidget(
      harness(db: db, home: const LoginPage(), auth: AuthState.signedOut, locale: const Locale('pt', 'BR')),
    );
    await tester.pumpAndSettle();
    expect(find.text('Entrar'), findsOneWidget);
    expect(find.text('Trabalho em campo. Controle em cada etapa.'), findsOneWidget);
    await disposeAll(tester);
  });

  testWidgets('orders list shows synced orders and flags unsynced local changes', (tester) async {
    await tester.runAsync(() async {
      await db.upsertOrders(company, [orderJson(), orderJson(id: 'o2', number: 2, status: 'APPROVED')]);
      await addOp(db, 'EXECUTION_START', {'orderId': orderId, 'executionId': 'e1'});
    });
    await tester.pumpWidget(harness(db: db, home: const OrdersPage()));
    await tester.pump(const Duration(milliseconds: 200));
    await tester.pump(const Duration(milliseconds: 200));

    expect(find.text('#1'), findsOneWidget);
    expect(find.text('#2'), findsOneWidget);
    expect(find.text('In progress'), findsWidgets, reason: 'local start is shown right away');
    expect(find.text('Pending'), findsOneWidget, reason: 'and marked as not yet on the server');
    await disposeAll(tester);
  });

  testWidgets('technician fills the checklist offline; changes are queued with stable ids and flagged', (tester) async {
    await tester.runAsync(() async {
      await db.upsertOrders(company, [orderJson()]);
      await addOp(db, 'EXECUTION_START', {'orderId': orderId, 'executionId': 'e0000000-0000-4000-8000-000000000001'});
    });
    await tester.pumpWidget(harness(db: db, home: const ExecutionPage(orderId: orderId)));
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pump(const Duration(milliseconds: 300));

    expect(find.text('Desligar disjuntor'), findsOneWidget);
    final finish = find.byKey(const Key('finish-button'));
    await tester.scrollUntilVisible(finish, 300, scrollable: find.byType(Scrollable).first);
    expect(find.text('Complete the required items first.', skipOffstage: false), findsOneWidget);
    expect(tester.widget<FilledButton>(finish).onPressed, isNull);

    await tester.ensureVisible(find.byType(CheckboxListTile).first);
    await tester.pump();
    await tester.tap(find.byType(CheckboxListTile).first);
    await tester.pump(const Duration(milliseconds: 300));
    await tester.scrollUntilVisible(find.byKey(const Key('note-field')), 300, scrollable: find.byType(Scrollable).first);
    await tester.enterText(find.byKey(const Key('note-field')), 'Sem sinal no local');
    await tester.tap(find.byKey(const Key('note-add')));
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pump(const Duration(milliseconds: 300));

    final ops = await tester.runAsync(() => db.watchOutbox(company).first);
    expect(ops!.map((o) => o.type), ['EXECUTION_START', 'ITEM_UPDATE', 'NOTE_ADD']);
    expect(ops.map((o) => o.state).toSet(), {OpState.pending});
    expect(ops.map((o) => o.operationId).toSet(), hasLength(3));
    expect(jsonDecode(ops[1].payload), containsPair('itemPosition', 0));
    expect(find.text('Sem sinal no local', skipOffstage: false), findsOneWidget);
    expect(find.text('Pending', skipOffstage: false), findsWidgets);

    // Required item is done but the signature step is still missing.
    await tester.scrollUntilVisible(finish, 300, scrollable: find.byType(Scrollable).first);
    expect(find.text('Record the signature step before finishing.', skipOffstage: false), findsOneWidget);
    expect(tester.widget<FilledButton>(finish).onPressed, isNull);
    await disposeAll(tester);
  });

  testWidgets('recording the signature step enables finishing', (tester) async {
    await tester.runAsync(() async {
      await db.upsertOrders(company, [orderJson()]);
      await addOp(db, 'EXECUTION_START', {'orderId': orderId, 'executionId': 'e1'});
      await addOp(db, 'ITEM_UPDATE', {'executionId': 'e1', 'itemPosition': 0, 'done': true});
    });
    await tester.pumpWidget(harness(db: db, home: const ExecutionPage(orderId: orderId)));
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pump(const Duration(milliseconds: 300));

    await tester.scrollUntilVisible(find.text('Signature'), 300, scrollable: find.byType(Scrollable).first);
    await tester.ensureVisible(find.text('Signature'));
    await tester.pump();
    await tester.tap(find.text('Signature'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Absent'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('signature-reason')), 'Ninguém no local');
    await tester.pump();
    await tester.tap(find.byKey(const Key('signature-save')));
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pumpAndSettle();

    final finish = find.byKey(const Key('finish-button'));
    await tester.scrollUntilVisible(finish, 300, scrollable: find.byType(Scrollable).first);
    expect(tester.widget<FilledButton>(finish).onPressed, isNotNull);
    final ops = await tester.runAsync(() => db.watchOutbox(company).first);
    expect(ops!.last.type, 'SIGNATURE_SET');
    expect(jsonDecode(ops.last.payload), containsPair('status', 'ABSENT'));
    await disposeAll(tester);
  });

  testWidgets('signature pad produces a valid, small PNG from drawn strokes', (tester) async {
    final controller = SignatureController();
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: SignaturePad(controller: controller))));
    expect(controller.isEmpty, isTrue);

    await tester.drag(find.byKey(const Key('signature-pad')), const Offset(120, 40));
    await tester.pump();
    expect(controller.isEmpty, isFalse);

    final png = await tester.runAsync(() => controller.toPng());
    expect(png!.sublist(0, 8), Uint8List.fromList([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(png.length, lessThan(256 * 1024), reason: 'the server rejects signatures above 256 KB');
    expect(base64Decode(base64Encode(png)), png);

    controller.clear();
    expect(controller.isEmpty, isTrue);
  });

  testWidgets('order detail offers to start only for the assigned technician', (tester) async {
    await tester.runAsync(() => db.upsertOrders(company, [orderJson()]));
    await tester.pumpWidget(harness(db: db, home: const OrderDetailPage(orderId: orderId)));
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('Start execution'), findsOneWidget);
    await disposeAll(tester);

    db = memoryDb();
    await tester.runAsync(() => db.upsertOrders(company, [orderJson()]));
    final other = Session(
      userId: 'u2',
      name: 'Outro',
      email: 'o@example.com',
      memberships: const [Membership(membershipId: 'someone-else', companyId: company, companyName: 'Acme', role: 'PROFESSIONAL')],
    );
    await tester.pumpWidget(
      harness(db: db, home: const OrderDetailPage(orderId: orderId), auth: AuthState(session: other, companyId: company)),
    );
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('Start execution'), findsNothing);
    await disposeAll(tester);
  });
}
