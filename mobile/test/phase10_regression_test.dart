import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:servicecheck/core/db/app_database.dart';
import 'package:servicecheck/core/l10n.dart';
import 'package:servicecheck/core/server_error.dart';
import 'package:servicecheck/features/orders/execution_page.dart';
import 'package:servicecheck/features/settings/sync_issues_page.dart';
import 'package:servicecheck/features/sync/sync_controller.dart';
import 'package:servicecheck/features/sync/sync_engine.dart';
import 'package:servicecheck/shared/app_shell.dart';

import 'support/fixtures.dart';
import 'widget_flows_test.dart' show NoopSync, harness;

/// Lets a test flip the sync state while the screen is on, as a real connection change does.
class ToggleSync extends NoopSync {
  void show(SyncPhase phase) => state = SyncStatus(phase: phase);
}

/// Counts how often the screen below the banner is created and destroyed.
class _Probe extends StatefulWidget {
  const _Probe();
  static int created = 0;
  static int disposed = 0;

  @override
  State<_Probe> createState() => _ProbeState();
}

class _ProbeState extends State<_Probe> {
  @override
  void initState() {
    super.initState();
    _Probe.created++;
  }

  @override
  void dispose() {
    _Probe.disposed++;
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => const Padding(padding: EdgeInsets.all(16), child: TextField(key: Key('draft')));
}

class OfflineSync extends NoopSync {
  @override
  SyncStatus build() => const SyncStatus(phase: SyncPhase.offline);
}

const orderId = 'o0000000-0000-4000-8000-000000000001';
const serverForbidden = '{"message":"Only an assigned technician can start the execution","error":"Forbidden","statusCode":403}';

final extraRoutes = <RouteBase>[
  GoRoute(path: '/orders', builder: (_, _) => const Scaffold(body: Text('orders-list'))),
  GoRoute(path: '/settings/sync-issues', builder: (_, _) => const SyncIssuesPage()),
];

void main() {
  late AppDatabase db;
  setUp(() => db = memoryDb());

  Future<void> disposeAll(WidgetTester tester) async {
    await tester.pumpWidget(const SizedBox());
    await tester.pump(const Duration(seconds: 1));
    await tester.runAsync(db.close);
  }

  Future<void> settle(WidgetTester tester) async {
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pump(const Duration(milliseconds: 300));
  }

  group('execution screen after the server rejected the local start', () {
    Future<void> seedRejected(WidgetTester tester) => tester.runAsync(() async {
          // The server snapshot: cancelled, no execution. The local start was refused.
          await db.upsertOrders(company, [orderJson(status: 'CANCELLED')]);
          await addOp(
            db,
            'EXECUTION_START',
            {'orderId': orderId, 'executionId': 'e1'},
            operationId: 'rejected-start',
            state: OpState.rejected,
            error: serverForbidden,
          );
        });

    testWidgets('explains what happened instead of a generic error, and shows no local data as confirmed', (tester) async {
      await seedRejected(tester);
      await tester.pumpWidget(harness(db: db, home: const ExecutionPage(orderId: orderId), extraRoutes: extraRoutes));
      await settle(tester);

      expect(find.text('Something went wrong.'), findsNothing);
      expect(find.text('Execution not available'), findsOneWidget);
      expect(find.textContaining('cancelled on the server'), findsOneWidget);
      expect(find.byKey(const Key('finish-button')), findsNothing, reason: 'no checklist or actions from the rejected local execution');
      expect(find.text('Desligar disjuntor'), findsNothing);
      await disposeAll(tester);
    });

    testWidgets('offers working navigation to the order list and to the sync issues', (tester) async {
      await seedRejected(tester);
      await tester.pumpWidget(harness(db: db, home: const ExecutionPage(orderId: orderId), extraRoutes: extraRoutes));
      await settle(tester);

      await tester.tap(find.byKey(const Key('open-sync-issues')));
      await settle(tester);
      expect(find.text('Rejected by the server'), findsOneWidget);
      await disposeAll(tester);

      db = memoryDb();
      await seedRejected(tester);
      await tester.pumpWidget(harness(db: db, home: const ExecutionPage(orderId: orderId), extraRoutes: extraRoutes));
      await settle(tester);
      await tester.tap(find.byKey(const Key('back-to-orders')));
      await settle(tester);
      expect(find.text('orders-list'), findsOneWidget);
      await disposeAll(tester);
    });

    testWidgets('never discards the rejected operation by itself', (tester) async {
      await seedRejected(tester);
      await tester.pumpWidget(harness(db: db, home: const ExecutionPage(orderId: orderId), extraRoutes: extraRoutes));
      await settle(tester);
      await tester.tap(find.byKey(const Key('back-to-orders')));
      await settle(tester);

      final ops = await tester.runAsync(() => db.watchOutbox(company).first);
      expect(ops!.single.operationId, 'rejected-start');
      expect(ops.single.state, OpState.rejected);
      expect(ops.single.lastError, serverForbidden, reason: 'the server answer is kept verbatim');
      await disposeAll(tester);
    });

    testWidgets('a non-cancelled order uses the neutral wording', (tester) async {
      await tester.runAsync(() => db.upsertOrders(company, [orderJson()]));
      await tester.pumpWidget(harness(db: db, home: const ExecutionPage(orderId: orderId), extraRoutes: extraRoutes));
      await settle(tester);
      expect(find.textContaining('no active execution'), findsOneWidget);
      expect(find.byKey(const Key('open-sync-issues')), findsNothing, reason: 'nothing to look at');
      await disposeAll(tester);
    });
  });

  group('server error messages are localized from stable identifiers', () {
    Future<void> showIssue(WidgetTester tester, Locale locale, String error) async {
      await tester.runAsync(() => addOp(db, 'ITEM_UPDATE', {'x': 1}, operationId: 'x', state: OpState.rejected, error: error));
      await tester.pumpWidget(harness(db: db, home: const SyncIssuesPage(), locale: locale));
      await settle(tester);
    }

    testWidgets('Portuguese: status 403 gets the Portuguese sentence, server text stays as detail', (tester) async {
      await showIssue(tester, const Locale('pt', 'BR'), serverForbidden);
      expect(find.text('Você não tem permissão para esta ação.'), findsOneWidget);
      expect(find.textContaining('Detalhe do servidor: Only an assigned technician'), findsOneWidget);
      await disposeAll(tester);
    });

    testWidgets('English: status 409', (tester) async {
      await showIssue(tester, const Locale('en'), '{"message":"Order is not scheduled","statusCode":409}');
      expect(find.text('The order changed on the server and this change no longer applies.'), findsOneWidget);
      await disposeAll(tester);
    });

    testWidgets('an unknown status falls back to the generic message', (tester) async {
      await showIssue(tester, const Locale('en'), '{"message":"boom","statusCode":500}');
      expect(find.text('Something went wrong.'), findsOneWidget);
      await disposeAll(tester);
    });

    test('ServerError parses Nest bodies, validation arrays, upload text and junk', () async {
      expect(ServerError.parse(serverForbidden).status, 403);
      final validation = ServerError.parse('{"message":["a must be a string","b is required"],"statusCode":400}');
      expect(validation.status, 400);
      expect(validation.message, 'a must be a string; b is required');
      final upload = ServerError.parse('413: File exceeds 10 MB');
      expect((upload.status, upload.message), (413, 'File exceeds 10 MB'));
      expect(ServerError.parse('not json at all').status, isNull);
      expect(ServerError.parse(null).message, isNull);
      expect(ServerError.parse('{"message":"operationId already used"}').status, isNull);
    });

    test('every mapped status has a sentence in both languages', () async {
      final en = await AppL10n.delegate.load(const Locale('en'));
      final pt = await AppL10n.delegate.load(const Locale('pt'));
      for (final status in [400, 401, 403, 404, 409, 413, 422]) {
        final e = ServerError(status: status).describe(en);
        final p = ServerError(status: status).describe(pt);
        expect(e, isNot(en.genericError), reason: 'en $status');
        expect(p, isNot(pt.genericError), reason: 'pt $status');
        expect(e, isNot(p), reason: 'translated $status');
      }
      expect(const ServerError(status: 500).describe(pt), pt.genericError);
    });
  });

  group('sync banner and title bar', () {
    const statusBar = 40.0;

    Widget screen() => MediaQuery(
          data: const MediaQueryData(padding: EdgeInsets.only(top: statusBar)),
          child: SyncBanner(child: Scaffold(appBar: AppBar(title: const Text('Title')), body: const SizedBox())),
        );

    testWidgets('with the banner the status bar inset is applied once, and the two do not overlap', (tester) async {
      await tester.pumpWidget(harness(db: db, home: screen(), sync: OfflineSync.new));
      await settle(tester);

      final banner = tester.getRect(find.text('Offline · No pending changes'));
      final bar = tester.getRect(find.byType(AppBar));
      expect(bar.height, kToolbarHeight, reason: 'no second status bar inset above the title');
      expect(bar.top, greaterThanOrEqualTo(banner.bottom), reason: 'no overlap');
      expect(bar.top - banner.bottom, lessThan(24), reason: 'no big vertical gap');
      await disposeAll(tester);
    });

    testWidgets('without the banner the title bar keeps the status bar inset', (tester) async {
      await tester.pumpWidget(harness(db: db, home: screen()));
      await settle(tester);
      expect(find.textContaining('Offline'), findsNothing);
      expect(tester.getSize(find.byType(AppBar)).height, kToolbarHeight + statusBar);
      await disposeAll(tester);
    });

    testWidgets('small and large screens behave the same', (tester) async {
      for (final size in const [Size(320, 568), Size(430, 932)]) {
        tester.view.physicalSize = size;
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        db = memoryDb();
        await tester.pumpWidget(harness(db: db, home: screen(), sync: OfflineSync.new));
        await settle(tester);
        expect(tester.getSize(find.byType(AppBar)).height, kToolbarHeight, reason: '$size');
        expect(tester.takeException(), isNull, reason: 'no overflow at $size');
        await disposeAll(tester);
      }
    });
  });

  group('connection changes while a screen is being edited', () {
    testWidgets('the banner appearing and disappearing keeps the navigator, the screen state and the typed text', (tester) async {
      _Probe.created = 0;
      _Probe.disposed = 0;
      final home = SyncBanner(
        child: Navigator(
          onGenerateRoute: (_) => MaterialPageRoute<void>(
            builder: (_) => Scaffold(appBar: AppBar(title: const Text('Edit')), body: const _Probe()),
          ),
        ),
      );
      await tester.pumpWidget(harness(db: db, home: home, sync: ToggleSync.new));
      await settle(tester);

      final navigator = find.descendant(of: find.byType(SyncBanner), matching: find.byType(Navigator));
      final navigatorBefore = tester.state<NavigatorState>(navigator);
      final input = find.byKey(const Key('draft'));
      await tester.enterText(input, 'rascunho da observação');
      await tester.pump();
      final focusNode = tester.widget<EditableText>(find.descendant(of: input, matching: find.byType(EditableText))).focusNode;
      expect(focusNode.hasFocus, isTrue, reason: 'precondition');
      final controller = ProviderScope.containerOf(tester.element(find.byType(SyncBanner))).read(syncProvider.notifier) as ToggleSync;

      void expectPreserved(String when) {
        expect(find.text('rascunho da observação'), findsOneWidget, reason: 'text kept ');
        expect(identical(tester.state<NavigatorState>(navigator), navigatorBefore), isTrue, reason: 'same navigator ');
        expect((_Probe.created, _Probe.disposed), (1, 0), reason: 'screen not rebuilt from scratch ');
        expect(focusNode.hasFocus, isTrue, reason: 'focus kept ');
      }

      controller.show(SyncPhase.offline);
      await settle(tester);
      expect(find.textContaining('Offline'), findsOneWidget);
      expectPreserved('with the banner showing');

      controller.show(SyncPhase.idle);
      await settle(tester);
      expect(find.textContaining('Offline'), findsNothing);
      expectPreserved('after the banner is gone');

      controller.show(SyncPhase.offline);
      await settle(tester);
      expectPreserved('when it comes back');
      await disposeAll(tester);
    });
  });

  group('keyboard focus', () {
    testWidgets('closing the signature sheet does not give focus back to the note field', (tester) async {
      await tester.runAsync(() async {
        await db.upsertOrders(company, [orderJson()]);
        await addOp(db, 'EXECUTION_START', {'orderId': orderId, 'executionId': 'e1'});
        await addOp(db, 'ITEM_UPDATE', {'executionId': 'e1', 'itemPosition': 0, 'done': true});
      });
      await tester.pumpWidget(harness(db: db, home: const ExecutionPage(orderId: orderId)));
      await settle(tester);

      final noteInput = find.descendant(of: find.byKey(const Key('note-field')), matching: find.byType(EditableText));
      await tester.scrollUntilVisible(find.byKey(const Key('note-field')), 300, scrollable: find.byType(Scrollable).first);
      await tester.tap(find.byKey(const Key('note-field')));
      await tester.pump();
      expect(tester.widget<EditableText>(noteInput).focusNode.hasFocus, isTrue, reason: 'precondition: the field is focused');

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
      await settle(tester);
      await tester.pumpAndSettle();

      expect(tester.widget<EditableText>(noteInput).focusNode.hasFocus, isFalse);
      await disposeAll(tester);
    });
  });
}
