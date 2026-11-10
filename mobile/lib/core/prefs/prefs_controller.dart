import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers.dart';

class Prefs {
  const Prefs({this.themeMode = ThemeMode.system, this.locale});
  final ThemeMode themeMode;

  /// null follows the device language.
  final Locale? locale;
}

final prefsProvider = NotifierProvider<PrefsController, Prefs>(PrefsController.new);

class PrefsController extends Notifier<Prefs> {
  static const _themeKey = 'themeMode';
  static const _localeKey = 'locale';

  @override
  Prefs build() {
    Future<void>.microtask(_load);
    return const Prefs();
  }

  Future<void> _load() async {
    final db = ref.read(appDatabaseProvider);
    final theme = await db.getKv(_themeKey);
    final locale = await db.getKv(_localeKey);
    state = Prefs(
      themeMode: ThemeMode.values.where((m) => m.name == theme).firstOrNull ?? ThemeMode.system,
      locale: switch (locale) {
        'en' => const Locale('en'),
        'pt_BR' => const Locale('pt', 'BR'),
        _ => null,
      },
    );
  }

  Future<void> setThemeMode(ThemeMode mode) async {
    state = Prefs(themeMode: mode, locale: state.locale);
    await ref.read(appDatabaseProvider).setKv(_themeKey, mode.name);
  }

  Future<void> setLocale(Locale? locale) async {
    state = Prefs(themeMode: state.themeMode, locale: locale);
    await ref.read(appDatabaseProvider).setKv(_localeKey, locale == null ? null : '${locale.languageCode}${locale.countryCode == null ? '' : '_${locale.countryCode}'}');
  }
}