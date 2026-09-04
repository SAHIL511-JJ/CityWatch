# Mobile (WT4) — Flutter app, FastAPI only

Talks to FastAPI via `dio`. No `supabase-flutter`.

## Prereqs

- Flutter SDK >= 3.22
- Running backend (`AppConfig.baseUrl`, default `http://10.0.2.2:8000` for Android emulator)

## Steps

```sh
flutter pub get && flutter analyze
flutter run --dart-define=API_URL=http://10.0.2.2:8000
```

## API contract used

- `POST /auth/anonymous` {device_id} -> {token, user_id}
- `POST /auth/send-code` {phone|email}
- `POST /auth/verify` {phone|email, code} -> {token}
- `POST /incidents` multipart(title, description, lat, lng, address?, photo)
- `GET /incidents?lat&lng&radius_km&severity&category` (verified only)

## Layout

- `lib/config.dart` — baseUrl (`--dart-define=API_URL=…`)
- `lib/api_client.dart` — dio + JWT interceptor, feed + submit
- `lib/auth_provider.dart` — anonymous device_id (secure_storage + uuid), send/verify, JWT store
- `lib/screens/feed_screen.dart` — flutter_map + list toggle
- `lib/screens/report_screen.dart` — title/description/photo/GPS submit
- `lib/screens/verify_screen.dart` — phone/email + code
- `lib/screens/settings_screen.dart` — radius, min severity, FCM stub
