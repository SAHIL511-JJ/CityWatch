import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth_provider.dart';
import '../config.dart';
import '../cw_theme.dart';
import '../feed_filters.dart';
import 'verify_screen.dart';

/// Profile hub (KAN-22): every shipped screen reachable in two taps.
/// Verify opens as a pushed route; Settings live here on the shared
/// filter providers (KAN-26); About hides the raw wiring details.
class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final radius = ref.watch(radiusKmProvider);
    final severity = ref.watch(severityFilterProvider);
    final category = ref.watch(categoryFilterProvider);
    final auth = ref.watch(authProvider);
    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: false,
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Profile'),
            Text(
              'Your identity and feed preferences',
              style: TextStyle(
                color: Color(0xFFB9C9BD),
                fontSize: 11,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 20, 16, 28),
        children: [
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: const Color(0xFFD8E9D8),
              borderRadius: BorderRadius.circular(22),
            ),
            child: Row(
              children: [
                Container(
                  width: 54,
                  height: 54,
                  decoration: BoxDecoration(
                    color: const Color(0xFF2E5B45),
                    borderRadius: BorderRadius.circular(17),
                  ),
                  child: Center(
                    child: Text(auth.verified ? 'V' : 'A',
                        style: const TextStyle(
                            color: Colors.white,
                            fontSize: 22,
                            fontWeight: FontWeight.w800)),
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                          auth.verified
                              ? 'Verified resident'
                              : 'Anonymous resident',
                          style: Theme.of(context).textTheme.titleMedium),
                      const SizedBox(height: 4),
                      Text(
                          auth.verified
                              ? 'Your reports rank higher in review.'
                              : 'Verify once to lift your reports.',
                          style: Theme.of(context).textTheme.bodySmall),
                    ],
                  ),
                ),
                IconButton(
                  tooltip:
                      auth.verified ? 'Verification details' : 'Verify now',
                  onPressed: () => Navigator.push(
                    context,
                    MaterialPageRoute(builder: (_) => const VerifyScreen()),
                  ),
                  icon: const Icon(Icons.arrow_forward_rounded),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),
          Text('Feed preferences',
              style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 6),
          Text('Tune what appears in your nearby feed.',
              style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: 14),
          Card(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Icon(Icons.radar_outlined,
                          color: Color(0xFF2E5B45)),
                      const SizedBox(width: 10),
                      Text('Alert radius',
                          style: Theme.of(context).textTheme.titleMedium),
                      const Spacer(),
                      Text('${radius.toStringAsFixed(0)} km',
                          style: const TextStyle(fontWeight: FontWeight.w800)),
                    ],
                  ),
                  Slider(
                    min: 1,
                    max: 50,
                    divisions: 49,
                    value: radius,
                    label: '${radius.toStringAsFixed(0)} km',
                    onChanged: (v) =>
                        ref.read(radiusKmProvider.notifier).state = v,
                  ),
                  const Divider(height: 8),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.tune_rounded,
                        color: Color(0xFF2E5B45)),
                    title: const Text('Minimum severity'),
                    trailing: _selectMenu<String>(
                      value: severity,
                      label: severityLabel(severity),
                      values: feedSeverities,
                      labels: feedSeverities.map(severityLabel).toList(),
                      onSelected: (v) =>
                          ref.read(severityFilterProvider.notifier).state = v,
                    ),
                  ),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.category_outlined,
                        color: Color(0xFF2E5B45)),
                    title: const Text('Category'),
                    trailing: _selectMenu<String>(
                      value: category,
                      label: categoryLabel(category),
                      values: feedCategories,
                      labels: feedCategories.map(categoryLabel).toList(),
                      onSelected: (v) =>
                          ref.read(categoryFilterProvider.notifier).state = v,
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 20),
          Text('Account', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 10),
          Card(
            child: Column(
              children: [
                const ExpansionTile(
                  leading: Icon(Icons.info_outline_rounded),
                  title: Text('About CityWatch'),
                  children: [
                    ListTile(
                      title: Text('Version'),
                      subtitle: Text(
                        'CityWatch citizen app ${AppConfig.version} · built ${AppConfig.buildDate}',
                      ),
                    ),
                    ListTile(
                      title: Text('Server'),
                      subtitle: Text(AppConfig.baseUrl),
                    ),
                  ],
                ),
                ListTile(
                  leading: const Icon(Icons.refresh_rounded),
                  title: const Text('Refresh session'),
                  onTap: () async =>
                      ref.read(authProvider.notifier).ensureAnonymous(),
                ),
                ListTile(
                  leading: const Icon(Icons.logout_rounded),
                  title: const Text('Sign out and start fresh'),
                  onTap: () async {
                    await ref.read(authProvider.notifier).signOut();
                    await ref.read(authProvider.notifier).ensureAnonymous();
                  },
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _selectMenu<T>({
    required T value,
    required String label,
    required List<T> values,
    required List<String> labels,
    required ValueChanged<T> onSelected,
  }) {
    return PopupMenuButton<T>(
      tooltip: label,
      color: CwColors.paper,
      elevation: 10,
      offset: const Offset(0, 8),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: const BorderSide(color: CwColors.sand),
      ),
      onSelected: onSelected,
      itemBuilder: (_) => List.generate(
        values.length,
        (i) => PopupMenuItem<T>(
          value: values[i],
          height: 44,
          child: Row(
            children: [
              Expanded(
                child: Text(labels[i],
                    style: const TextStyle(fontWeight: FontWeight.w600)),
              ),
              if (values[i] == value)
                const Icon(Icons.check_rounded, size: 18, color: CwColors.pine),
            ],
          ),
        ),
      ),
      child: Container(
        constraints: const BoxConstraints(minWidth: 92),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
        decoration: BoxDecoration(
          color: CwColors.cream,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: CwColors.sand),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(label, style: const TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(width: 8),
            const Icon(Icons.expand_more, size: 17, color: CwColors.pine),
          ],
        ),
      ),
    );
  }
}
