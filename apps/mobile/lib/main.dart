import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'auth_provider.dart';
import 'screens/feed_screen.dart';
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
          // Offline first-run: user can retry from settings/verify.
        }
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Incident Reporter',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.deepOrange),
        useMaterial3: true,
      ),
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
        ],
      ),
    );
  }
}
