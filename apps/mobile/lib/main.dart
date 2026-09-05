import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'auth_provider.dart';
import 'cw_theme.dart';
import 'outbox.dart';
import 'screens/feed_screen.dart';
import 'screens/my_reports_screen.dart';
import 'screens/profile_screen.dart';
import 'screens/report_screen.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const ProviderScope(child: IncidentReporterApp()));
}

class IncidentReporterApp extends ConsumerStatefulWidget {
  const IncidentReporterApp({super.key});

  @override
  ConsumerState<IncidentReporterApp> createState() =>
      _IncidentReporterAppState();
}

class _IncidentReporterAppState extends ConsumerState<IncidentReporterApp> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() async {
      final auth = ref.read(authProvider.notifier);
      await auth.loadFromStorage();
      if (!ref.read(authProvider).isLoggedIn) {
        try {
          await auth.ensureAnonymous();
        } catch (_) {
          // Offline first-run: feed shows the offline state with retry.
        }
      }
      // KAN-28: flush any reports queued while offline.
      try {
        await ref.read(outboxProvider.notifier).retryAll();
      } catch (_) {
        // Retry surfaces inside My reports; never block boot.
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'CityWatch',
      debugShowCheckedModeBanner: false,
      theme: cityWatchTheme(),
      home: const HomeShell(),
    );
  }
}

class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _index = 0;

  static const _pages = [
    FeedScreen(),
    ReportScreen(),
    MyReportsScreen(),
    ProfileScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(index: _index, children: _pages),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.home_outlined),
            selectedIcon: Icon(Icons.home),
            label: 'Feed',
          ),
          NavigationDestination(
            icon: Icon(Icons.add_a_photo_outlined),
            selectedIcon: Icon(Icons.add_a_photo),
            label: 'Report',
          ),
          NavigationDestination(
            icon: Icon(Icons.history_outlined),
            selectedIcon: Icon(Icons.history),
            label: 'My reports',
          ),
          NavigationDestination(
            icon: Icon(Icons.person_outlined),
            selectedIcon: Icon(Icons.person),
            label: 'Profile',
          ),
        ],
      ),
    );
  }
}
