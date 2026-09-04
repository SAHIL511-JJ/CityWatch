import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api_client.dart';
import '../auth_provider.dart';
import '../config.dart';

final radiusKmProvider = StateProvider<double>((ref) => 10);
final minSeverityProvider = StateProvider<String>((ref) => 'medium');

const _severities = ['low', 'medium', 'high', 'critical'];

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  String? _fcmStatus;

  Future<void> _uploadFcmToken() async {
    setState(() => _fcmStatus = 'Fetching FCM token…');
    try {
      final messaging = FirebaseMessaging.instance;
      await messaging.requestPermission();
      final token = await messaging.getToken();
      if (token == null || token.isEmpty) {
        throw StateError('No FCM token (is Firebase configured?)');
      }
      // Stub: POST /users/me/fcm-token (404-tolerant until backend adds it).
      await ref.read(apiClientProvider).uploadFcmToken(token);
      setState(() => _fcmStatus = 'FCM token uploaded (stub OK).');
    } catch (e) {
      setState(() => _fcmStatus = 'FCM stub failed: $e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final radius = ref.watch(radiusKmProvider);
    final minSeverity = ref.watch(minSeverityProvider);
    final auth = ref.watch(authProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('Alert radius: ${radius.toStringAsFixed(0)} km'),
          Slider(
            min: 1,
            max: 50,
            divisions: 49,
            value: radius,
            label: '${radius.toStringAsFixed(0)} km',
            onChanged: (v) =>
                ref.read(radiusKmProvider.notifier).state = v,
          ),
          const SizedBox(height: 8),
          const Text('Minimum alert severity'),
          DropdownButton<String>(
            value: minSeverity,
            items: _severities
                .map((s) => DropdownMenuItem(value: s, child: Text(s)))
                .toList(),
            onChanged: (v) {
              if (v != null) ref.read(minSeverityProvider.notifier).state = v;
            },
          ),
          const Divider(height: 32),
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Backend'),
            subtitle: const Text(AppConfig.baseUrl),
          ),
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Session'),
            subtitle: Text(
              auth.isLoggedIn
                  ? '${auth.verified ? 'verified' : 'anonymous'} · ${auth.userId ?? ''}'
                  : 'not logged in',
            ),
            trailing: TextButton(
              onPressed: () async {
                await ref.read(authProvider.notifier).ensureAnonymous();
              },
              child: const Text('Re-login'),
            ),
          ),
          const Divider(height: 32),
          FilledButton.tonalIcon(
            onPressed: _uploadFcmToken,
            icon: const Icon(Icons.notifications_outlined),
            label: const Text('Enable push (FCM stub)'),
          ),
          if (_fcmStatus != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                _fcmStatus!,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
        ],
      ),
    );
  }
}
