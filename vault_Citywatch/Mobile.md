# Mobile

Flutter citizen app in `apps/mobile` — **scaffold status**: compiles and matches the API contract, but is not a finished app.

## What exists

- **Screens** (`lib/screens/`): report (photo+text+GPS), map/list feed, verify (enter code), settings (radius, severity).
- **Dio client** (`lib/api_client.dart`): `postAnonymous`, `sendCode`, `verifyCode`, `createIncident` (multipart), `fetchFeed` (with a client-side verified-only guard), `fetchIncident`.
- **Secure storage**: JWT persisted via `flutter_secure_storage` and injected as `Bearer` by a Dio interceptor (`dioProvider`).
- **Base URL** (`lib/config.dart`): `--dart-define=API_URL=…`, default `http://10.0.2.2:8000` (Android emulator loopback).
- **Deps** (`pubspec.yaml`): `riverpod`, `flutter_map`, `geolocator`, `image_picker`, `dio`, `flutter_secure_storage`, `firebase_messaging`.

## NOT built yet

- Push handling: `uploadFcmToken` posts to `/users/me/fcm-token`, which the [[Backend]] does not expose — 404s are swallowed; no token/radius/severity persistence server-side.
- Photo display via signed URLs, offline support, and any direct-to-Storage upload (forbidden by [[Rules-and-Conventions]] anyway).

## API contract it must follow

`POST /auth/anonymous` → `POST /auth/send-code` → `POST /auth/verify` → `POST /incidents` (multipart) → `GET /incidents?lat&lng&radius_km` (verified only). It must never import Supabase or touch the [[Database]] directly — all traffic goes through the [[Backend]].

Related: [[Backend]], [[Rules-and-Conventions]], [[Architecture]].
