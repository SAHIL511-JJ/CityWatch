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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 760),
            child: IndexedStack(index: _index, children: [
              FeedScreen(onReport: () => setState(() => _index = 1)),
              const ReportScreen(),
              MyReportsScreen(onReport: () => setState(() => _index = 1)),
              const ProfileScreen(),
            ]),
          ),
        ),
      ),
      bottomNavigationBar: DecoratedBox(
        decoration: const BoxDecoration(
          color: CwColors.paper,
          border: Border(top: BorderSide(color: CwColors.sand)),
        ),
        child: SafeArea(
          top: false,
          child: Center(
            heightFactor: 1,
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 760),
              child: NavigationBar(
                selectedIndex: _index,
                onDestinationSelected: (i) => setState(() => _index = i),
                destinations: const [
                  NavigationDestination(
                    icon: Icon(Icons.home_outlined),
                    selectedIcon: Icon(Icons.home),
                    label: 'Feed',
                  ),
                  NavigationDestination(
                    icon: Icon(Icons.add_circle_outline_rounded),
                    selectedIcon: Icon(Icons.add_circle_rounded),
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
            ),
          ),
        ),
      ),
    );
  }
}
