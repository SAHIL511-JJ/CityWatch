import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:incident_reporter/api_client.dart';
import 'package:incident_reporter/main.dart';

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
  Future<List<int>?> fetchPhotoBytes(String id) async => null;
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
      {Size size = const Size(390, 844), double scale = 1}) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    tester.platformDispatcher.textScaleFactorTestValue = scale;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await tester.pumpWidget(ProviderScope(
      overrides: [apiClientProvider.overrideWithValue(_PreviewApi())],
      child: const IncidentReporterApp(),
    ));
    await tester.pumpAndSettle();
  }

  testWidgets('Feed opens a full report page and returns to the feed',
      (tester) async {
    await boot(tester);
    expect(find.text('Around your\nneighborhood.'), findsOneWidget);
    await tester.drag(find.byType(CustomScrollView), const Offset(0, -500));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Broken streetlight on Park Road'));
    await tester.pumpAndSettle();
    expect(find.text('Neighborhood report'), findsOneWidget);
    expect(find.text('Open in Google Maps'), findsOneWidget);
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    expect(find.byType(NavigationBar), findsOneWidget);
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
