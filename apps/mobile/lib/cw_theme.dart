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
  static const ink = Color(0xFF17382E);
  static const pine = Color(0xFF285E4A);
  static const pineDeep = Color(0xFF193B2C);
  static const mint = Color(0xFFE1EDDF);
  static const cream = Color(0xFFF5F5EF);
  static const paper = Color(0xFFFFFFFF);
  static const sand = Color(0xFFE4E9DF);
  static const muted = Color(0xFF6B756E);
  static const amber = Color(0xFFC57928);
}

ThemeData cityWatchTheme() {
  final base = ThemeData(
    useMaterial3: true,
    fontFamily: 'Verdana',
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
      backgroundColor: CwColors.cream,
      foregroundColor: CwColors.ink,
      surfaceTintColor: Colors.transparent,
      toolbarHeight: 76,
      elevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(
        fontFamily: 'Verdana',
        color: CwColors.ink,
        fontSize: 20,
        fontWeight: FontWeight.w700,
        letterSpacing: -0.4,
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: CwColors.paper.withValues(alpha: .96),
      elevation: 0,
      height: 72,
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
        borderRadius: BorderRadius.circular(24),
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
        minimumSize: const Size(0, 54),
        textStyle: const TextStyle(
            fontFamily: 'Verdana', fontSize: 14, fontWeight: FontWeight.w700),
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
      selectedColor: CwColors.pine,
      side: const BorderSide(color: CwColors.sand),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(30)),
      labelStyle: const TextStyle(fontWeight: FontWeight.w600),
    ),
    dividerTheme: const DividerThemeData(color: CwColors.sand, thickness: 1),
    progressIndicatorTheme:
        const ProgressIndicatorThemeData(color: CwColors.pine),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: CwColors.ink,
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
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

/// Shared page introduction; stays in the scroll view on small screens.
class CwPageIntro extends StatelessWidget {
  const CwPageIntro(
      {super.key,
      required this.eyebrow,
      required this.title,
      required this.description});

  final String eyebrow;
  final String title;
  final String description;

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(eyebrow.toUpperCase(),
              style: const TextStyle(
                  color: CwColors.pine,
                  fontSize: 10,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 2)),
          const SizedBox(height: 10),
          Text(title,
              style: Theme.of(context)
                  .textTheme
                  .headlineSmall
                  ?.copyWith(fontSize: 32, height: 1.16)),
          const SizedBox(height: 10),
          Text(description,
              style: Theme.of(context)
                  .textTheme
                  .bodyMedium
                  ?.copyWith(color: CwColors.muted)),
        ],
      );
}

/// A decorative neighborhood illustration, drawn locally without network assets.
class NeighborhoodArt extends StatelessWidget {
  const NeighborhoodArt({super.key, this.height = 150});
  final double height;

  @override
  Widget build(BuildContext context) => ExcludeSemantics(
        child: SizedBox(
            height: height,
            width: double.infinity,
            child: CustomPaint(painter: _NeighborhoodPainter())),
      );
}

class _NeighborhoodPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final scale = size.width / 340;
    canvas.save();
    canvas.translate((size.width - 340 * scale) / 2, size.height - 140 * scale);
    canvas.scale(scale);
    final fill = Paint();
    canvas.drawCircle(const Offset(245, 51), 43, fill..color = CwColors.mint);
    canvas.drawLine(
        const Offset(8, 126),
        const Offset(332, 126),
        Paint()
          ..color = CwColors.pine.withValues(alpha: .25)
          ..strokeWidth = 1.5);
    for (final building in [
      const Rect.fromLTWH(35, 63, 61, 63),
      const Rect.fromLTWH(113, 29, 70, 97),
      const Rect.fromLTWH(200, 72, 56, 54)
    ]) {
      canvas.drawRRect(
          RRect.fromRectAndRadius(building, const Radius.circular(5)),
          fill..color = CwColors.pine.withValues(alpha: .12));
      canvas.drawRRect(
          RRect.fromRectAndRadius(building, const Radius.circular(5)),
          Paint()
            ..color = CwColors.pine.withValues(alpha: .55)
            ..style = PaintingStyle.stroke
            ..strokeWidth = 1.5);
      for (double x = building.left + 13; x < building.right - 8; x += 19) {
        for (double y = building.top + 13; y < building.bottom - 15; y += 20) {
          canvas.drawRRect(
              RRect.fromRectAndRadius(
                  Rect.fromLTWH(x, y, 7, 9), const Radius.circular(1)),
              fill..color = CwColors.pine.withValues(alpha: .4));
        }
      }
    }
    canvas.drawLine(
        const Offset(288, 91),
        const Offset(288, 126),
        Paint()
          ..color = CwColors.pine
          ..strokeWidth = 3);
    canvas.drawOval(
        const Rect.fromLTWH(272, 61, 32, 43), fill..color = CwColors.pine);
    canvas.drawCircle(const Offset(183, 36), 18, fill..color = CwColors.pine);
    final check = Path()
      ..moveTo(176, 36)
      ..lineTo(181, 41)
      ..lineTo(191, 30);
    canvas.drawPath(
        check,
        Paint()
          ..color = Colors.white
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2.5
          ..strokeCap = StrokeCap.round
          ..strokeJoin = StrokeJoin.round);
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
