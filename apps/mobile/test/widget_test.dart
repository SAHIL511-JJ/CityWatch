import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:incident_reporter/main.dart';

void main() {
  testWidgets('App boots to Feed + Report shell', (WidgetTester tester) async {
    await tester.pumpWidget(const ProviderScope(child: IncidentReporterApp()));
    await tester.pump();
    expect(find.text('Feed'), findsWidgets);
    expect(find.text('Report'), findsWidgets);
    expect(find.text('My reports'), findsWidgets);
    expect(find.text('Profile'), findsWidgets);
  });
}
