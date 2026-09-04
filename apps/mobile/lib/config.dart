// Base URL for the FastAPI backend.
//
// Override at build/run time with:
//   flutter run --dart-define=API_URL=https://your-api.onrender.com
class AppConfig {
  static const String baseUrl = String.fromEnvironment(
    'API_URL',
    defaultValue: 'http://10.0.2.2:8000',
  );
}
