import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Single shared filter state for feed + settings (KAN-26).
final radiusKmProvider = StateProvider<double>((ref) => 10);
final severityFilterProvider = StateProvider<String>((ref) => '');
final categoryFilterProvider = StateProvider<String>((ref) => '');

const feedSeverities = ['', 'low', 'medium', 'high', 'critical'];
const feedCategories = ['', 'crime', 'fire', 'accident', 'hazard', 'other'];

String severityLabel(String s) => s.isEmpty ? 'All' : s;
String categoryLabel(String s) => s.isEmpty ? 'All' : s;
