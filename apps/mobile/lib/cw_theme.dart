import 'package:flutter/material.dart';

/// Shared CityWatch severity colors (KAN-25) — feed cards, badges, map pins.
Color severityColor(String? severity) {
  switch (severity) {
    case 'critical':
      return const Color(0xFFB3261E);
    case 'high':
      return const Color(0xFFC2410C);
    case 'medium':
      return const Color(0xFF8A6D00);
    default:
      return Colors.blueGrey;
  }
}

class CwColors {
  static const ink = Color(0xFF11231B);
  static const pine = Color(0xFF2E5B45);
  static const pineDeep = Color(0xFF193B2C);
  static const mint = Color(0xFFD8E9D8);
  static const cream = Color(0xFFF7F8F2);
  static const paper = Color(0xFFFFFFFF);
  static const sand = Color(0xFFE4E9DF);
  static const muted = Color(0xFF6B756E);
  static const amber = Color(0xFFC57928);
}

ThemeData cityWatchTheme() {
  final base = ThemeData(
    useMaterial3: true,
    fontFamily: 'Trebuchet MS',
  );
  final scheme = ColorScheme.fromSeed(
    seedColor: CwColors.pine,
    primary: CwColors.pine,
    surface: CwColors.cream,
    brightness: Brightness.light,
  );
  return base.copyWith(
    colorScheme: scheme,
    scaffoldBackgroundColor: CwColors.cream,
    visualDensity: VisualDensity.standard,
    appBarTheme: const AppBarTheme(
      backgroundColor: CwColors.ink,
      foregroundColor: Colors.white,
      elevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(
        color: Colors.white,
        fontSize: 22,
        fontWeight: FontWeight.w700,
        letterSpacing: -0.4,
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: CwColors.paper.withValues(alpha: .96),
      elevation: 0,
      height: 76,
      indicatorColor: CwColors.mint,
      labelTextStyle: const WidgetStatePropertyAll(
        TextStyle(
            fontSize: 12, fontWeight: FontWeight.w600, color: CwColors.ink),
      ),
    ),
    cardTheme: CardThemeData(
      color: CwColors.paper,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: const BorderSide(color: CwColors.sand),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: CwColors.paper,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: CwColors.sand),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: CwColors.sand),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: CwColors.pine, width: 2),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: CwColors.pine,
        foregroundColor: Colors.white,
        minimumSize: const Size(0, 48),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: CwColors.pineDeep,
        minimumSize: const Size(0, 48),
        side: const BorderSide(color: CwColors.sand),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
    ),
    chipTheme: base.chipTheme.copyWith(
      backgroundColor: CwColors.paper,
      selectedColor: CwColors.mint,
      side: const BorderSide(color: CwColors.sand),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      labelStyle: const TextStyle(fontWeight: FontWeight.w600),
    ),
    textTheme: base.textTheme.copyWith(
      headlineSmall: const TextStyle(
        color: CwColors.ink,
        fontSize: 26,
        fontWeight: FontWeight.w800,
        letterSpacing: -0.8,
      ),
      titleLarge: const TextStyle(
        color: CwColors.ink,
        fontSize: 21,
        fontWeight: FontWeight.w800,
        letterSpacing: -0.4,
      ),
      titleMedium: const TextStyle(
        color: CwColors.ink,
        fontSize: 16,
        fontWeight: FontWeight.w700,
      ),
      bodyLarge:
          const TextStyle(color: CwColors.ink, fontSize: 15, height: 1.45),
      bodyMedium:
          const TextStyle(color: CwColors.ink, fontSize: 14, height: 1.4),
      bodySmall:
          const TextStyle(color: CwColors.muted, fontSize: 12, height: 1.35),
    ),
  );
}
