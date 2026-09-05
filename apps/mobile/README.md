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

## Layout (2 tabs this round — Feed + Report)

- `lib/config.dart` — baseUrl (`--dart-define=API_URL=…`, emulator `http://10.0.2.2:8000`)
- `lib/api_client.dart` — dio + JWT interceptor, feed + submit + `photoUrlFor(id)` -> `GET /incidents/{id}/photo` (public, verified only)
- `lib/auth_provider.dart` — anonymous device_id auto-login behind the scenes
- `lib/screens/feed_screen.dart` — reels: vertical PageView, 1 post per screen, photo + severity + time/distance + Open in Google Maps
- `lib/screens/report_screen.dart` — title*/description*/photo*/GPS*, jpg/png <=8MB, no photo/GPS = no submit
- Verify/Settings screens exist but are hidden until profile round. Push/FCM stays OFF.
