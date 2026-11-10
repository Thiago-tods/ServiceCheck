import 'package:flutter/material.dart';

/// Industrial, functional look: neutral greys, one orange accent, small radii, flat surfaces.
class AppTheme {
  const AppTheme._();

  static const sans = 'IBM Plex Sans';
  static const mono = 'IBM Plex Mono';

  static const _radius = 6.0;
  static const orange = Color(0xFFE8590C);
  static const orangeDark = Color(0xFFFF8A3D);

  static ThemeData get light => _build(
        const ColorScheme(
          brightness: Brightness.light,
          primary: orange,
          onPrimary: Colors.white,
          secondary: Color(0xFF3B4252),
          onSecondary: Colors.white,
          error: Color(0xFFB42318),
          onError: Colors.white,
          surface: Colors.white,
          onSurface: Color(0xFF1F2328),
          surfaceContainerHighest: Color(0xFFEDEDEA),
          onSurfaceVariant: Color(0xFF5B6470),
          outline: Color(0xFFD0D4D9),
          outlineVariant: Color(0xFFE3E5E8),
        ),
        const Color(0xFFF4F4F2),
      );

  static ThemeData get dark => _build(
        const ColorScheme(
          brightness: Brightness.dark,
          primary: orangeDark,
          onPrimary: Color(0xFF1A0E05),
          secondary: Color(0xFFC3CAD6),
          onSecondary: Color(0xFF14161A),
          error: Color(0xFFFF8A80),
          onError: Color(0xFF14161A),
          surface: Color(0xFF1C1F24),
          onSurface: Color(0xFFE6E8EB),
          surfaceContainerHighest: Color(0xFF262A31),
          onSurfaceVariant: Color(0xFFA2A9B3),
          outline: Color(0xFF343A42),
          outlineVariant: Color(0xFF2A2F36),
        ),
        const Color(0xFF14161A),
      );

  static ThemeData _build(ColorScheme scheme, Color background) {
    final shape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(_radius),
      side: BorderSide(color: scheme.outline),
    );
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: background,
      fontFamily: sans,
      visualDensity: VisualDensity.standard,
      appBarTheme: AppBarTheme(
        backgroundColor: scheme.surface,
        foregroundColor: scheme.onSurface,
        elevation: 0,
        scrolledUnderElevation: 0,
        shape: Border(bottom: BorderSide(color: scheme.outline)),
        titleTextStyle: TextStyle(
          fontFamily: sans,
          fontSize: 18,
          fontWeight: FontWeight.w600,
          color: scheme.onSurface,
        ),
      ),
      cardTheme: CardThemeData(
        color: scheme.surface,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: shape,
      ),
      dividerTheme: DividerThemeData(color: scheme.outlineVariant, space: 1),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: scheme.surface,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(_radius),
          borderSide: BorderSide(color: scheme.outline),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(_radius),
          borderSide: BorderSide(color: scheme.outline),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(_radius),
          borderSide: BorderSide(color: scheme.primary, width: 2),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(64, 48),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(_radius)),
          textStyle: const TextStyle(fontWeight: FontWeight.w600),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(64, 48),
          side: BorderSide(color: scheme.outline),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(_radius)),
        ),
      ),
      chipTheme: ChipThemeData(
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(_radius),
          side: BorderSide(color: scheme.outline),
        ),
        side: BorderSide(color: scheme.outline),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: scheme.surface,
        indicatorColor: scheme.primary.withValues(alpha: 0.18),
        height: 68,
      ),
    );
  }
}

/// Style for identifiers and technical data (order numbers, ids, timestamps).
TextStyle monoStyle(BuildContext context, {double size = 13, FontWeight? weight}) {
  return TextStyle(
    fontFamily: AppTheme.mono,
    fontSize: size,
    fontWeight: weight ?? FontWeight.w500,
    color: Theme.of(context).colorScheme.onSurface,
  );
}