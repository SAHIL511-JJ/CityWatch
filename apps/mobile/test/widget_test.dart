import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:incident_reporter/api_client.dart';
import 'package:incident_reporter/cw_theme.dart';
import 'package:incident_reporter/main.dart';
import 'package:incident_reporter/screens/hotspot_detail_screen.dart';

class _PreviewApi extends ApiClient {
  _PreviewApi() : super(Dio());

  @override
  Future<List<IncidentItem>> fetchFeed(
          {required double lat,
          required double lng,
          double radiusKm = 10,
          String? severity,
          String? category,
          int limit = 50}) async =>
      [
        IncidentItem(
            id: 'preview',
            title: 'Broken streetlight on Park Road',
            description:
                'The footpath is dark near the park entrance. Please take care after sunset.',
            lat: 18.5196,
            lng: 73.8554,
            address: 'Park Road, near the north entrance',
            severity: 'medium',
            status: 'verified',
            createdAt: DateTime.now().toIso8601String()),
      ];

  @override
  Future<List<HotspotItem>> fetchHotspots({
    required double lat,
    required double lng,
    double radiusKm = 10,
    int windowDays = 30,
    String? category,
    String? severity,
    String? trend,
    int limit = 6,
  }) async =>
      [
        HotspotItem(
          id: 'flooding:18.51960:73.85540',
          category: 'flooding',
          centroidLat: 18.5196,
          centroidLng: 73.8554,
          reportCount: 4,
          uniqueContributors: 3,
          firstObserved: DateTime.now()
              .subtract(const Duration(days: 3))
              .toIso8601String(),
          lastObserved: DateTime.now().toIso8601String(),
          severitySummary: const {'high': 2, 'medium': 2},
          latestStatus: 'verified',
          persistenceScore: 78,
          trend: 'rising',
          meanDistanceKm: 0.18,
          reportIds: const ['preview'],
          explanation:
              '4 flooding observations from 3 contributor(s) across 3.0 days; mean spread 0.18 km; average confidence 91%.',
        ),
      ];

  @override
  Future<Map<String, dynamic>> fetchIncident(String id) async => {
        'id': 'preview',
        'title': 'Broken streetlight on Park Road',
        'description':
            'The footpath is dark near the park entrance. Please take care after sunset.',
        'lat': 18.5196,
        'lng': 73.8554,
        'address': 'Park Road, near the north entrance',
        'status': 'verified',
        'severity': 'medium',
        'created_at': DateTime.now().toIso8601String(),
      };

  @override
  Future<List<int>?> fetchPhotoBytes(String id) async => null;
}

class _EmptyHotspotApi extends _PreviewApi {
  @override
  Future<List<HotspotItem>> fetchHotspots({
    required double lat,
    required double lng,
    double radiusKm = 10,
    int windowDays = 30,
    String? category,
    String? severity,
    String? trend,
    int limit = 6,
  }) async =>
      [];
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({'jwt_token': 'test-session'});
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
            const MethodChannel('flutter.baseflow.com/geolocator'),
            (call) async {
      if (call.method == 'checkPermission') {
        return 3;
      }
      if (call.method == 'getCurrentPosition') {
        return {
          'latitude': 18.5196,
          'longitude': 73.8554,
          'timestamp': DateTime.now().millisecondsSinceEpoch,
          'accuracy': 10.0,
          'altitude': 0.0,
          'heading': 0.0,
          'speed': 0.0,
          'speed_accuracy': 0.0,
        };
      }
      return null;
    });
  });

  Future<void> boot(WidgetTester tester,
      {Size size = const Size(390, 844),
      double scale = 1,
      ApiClient? api}) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    tester.platformDispatcher.textScaleFactorTestValue = scale;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await tester.pumpWidget(ProviderScope(
      overrides: [apiClientProvider.overrideWithValue(api ?? _PreviewApi())],
      child: const IncidentReporterApp(),
    ));
    await tester.pumpAndSettle();
  }

  testWidgets('Feed opens a full report page and returns to the feed',
      (tester) async {
    await boot(tester);
    expect(find.text('Around your\nneighborhood.'), findsOneWidget);
    expect(find.text('Recurring near you'), findsOneWidget);
    await tester.drag(find.byType(CustomScrollView), const Offset(0, -500));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Broken streetlight on Park Road'));
    await tester.tap(find.text('Broken streetlight on Park Road'));
    await tester.pumpAndSettle();
    expect(find.text('Neighborhood report'), findsOneWidget);
    expect(find.text('Open in Google Maps'), findsOneWidget);
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    expect(find.byType(NavigationBar), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Hotspot detail shows the signal and a public report',
      (tester) async {
    final hotspot = (await _PreviewApi().fetchHotspots(lat: 0, lng: 0)).first;
    await tester.pumpWidget(ProviderScope(
      overrides: [apiClientProvider.overrideWithValue(_PreviewApi())],
      child: MaterialApp(
        theme: cityWatchTheme(),
        home: HotspotDetailScreen(hotspot: hotspot),
      ),
    ));
    await tester.pumpAndSettle();
    expect(find.text('Signal details'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('Related observations'),
      500,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('Related observations'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('Broken streetlight on Park Road'),
      500,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('Broken streetlight on Park Road'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Feed shows a calm empty state when no hotspot exists',
      (tester) async {
    await boot(tester, api: _EmptyHotspotApi());
    expect(find.text('No recurring signals yet'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
      'Report validates details and photo and preserves draft across tabs',
      (tester) async {
    await boot(tester);
    await tester.tap(find.text('Report').last);
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Continue'));
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(find.text('Add a short title and a line of detail first.'),
        findsOneWidget);
    await tester.enterText(find.byType(TextField).at(0), 'Broken streetlight');
    await tester.enterText(
        find.byType(TextField).at(1), 'The footpath near the park is dark.');
    await tester.tap(find.text('Profile').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Report').last);
    await tester.pumpAndSettle();
    expect(find.text('Broken streetlight'), findsOneWidget);
    await tester.ensureVisible(find.text('Continue'));
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(find.text('A photo tells the story.'), findsOneWidget);
    await tester.ensureVisible(find.text('Continue'));
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(find.text('A photo is required to send.'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  for (final size in [
    const Size(320, 640),
    const Size(390, 844),
    const Size(1200, 900)
  ]) {
    testWidgets('All tabs fit at ${size.width} px with enlarged text',
        (tester) async {
      await boot(tester, size: size, scale: 1.3);
      for (final label in ['Report', 'My reports', 'Profile', 'Feed']) {
        await tester.tap(find.text(label).last);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull,
            reason: '$label overflow at $size');
      }
    });
  }

  testWidgets('Empty queue action opens the report form', (tester) async {
    await boot(tester);
    await tester.tap(find.text('My reports').last);
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Create a report'));
    await tester.tap(find.text('Create a report'));
    await tester.pumpAndSettle();
    expect(find.text('Tell us what happened.'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
