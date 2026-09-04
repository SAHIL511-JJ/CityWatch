import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:uuid/uuid.dart';

import 'api_client.dart';

const _kDeviceKey = 'device_id';
const _kJwtKey = 'jwt_token';
const _kUserIdKey = 'user_id';
const _kVerifiedKey = 'verified';

class AuthState {
  const AuthState({
    this.token,
    this.userId,
    this.verified = false,
    this.loading = false,
    this.error,
  });

  final String? token;
  final String? userId;
  final bool verified;
  final bool loading;
  final String? error;

  bool get isLoggedIn => token != null && token!.isNotEmpty;

  AuthState copyWith({
    String? token,
    String? userId,
    bool? verified,
    bool? loading,
    String? error,
  }) {
    return AuthState(
      token: token ?? this.token,
      userId: userId ?? this.userId,
      verified: verified ?? this.verified,
      loading: loading ?? this.loading,
      error: error,
    );
  }
}

final authProvider = StateNotifierProvider<AuthNotifier, AuthState>((ref) {
  return AuthNotifier(
    ref.watch(apiClientProvider),
    ref.watch(secureStorageProvider),
  );
});

class AuthNotifier extends StateNotifier<AuthState> {
  AuthNotifier(this._api, this._storage) : super(const AuthState());

  final ApiClient _api;
  final FlutterSecureStorage _storage;
  final _uuid = const Uuid();

  Future<String> _deviceId() async {
    var id = await _storage.read(key: _kDeviceKey);
    if (id == null || id.isEmpty) {
      id = _uuid.v4();
      await _storage.write(key: _kDeviceKey, value: id);
    }
    return id;
  }

  Future<void> loadFromStorage() async {
    final token = await _storage.read(key: _kJwtKey);
    final userId = await _storage.read(key: _kUserIdKey);
    final verified = await _storage.read(key: _kVerifiedKey) == 'true';
    if (token != null && token.isNotEmpty) {
      state = state.copyWith(token: token, userId: userId, verified: verified);
    }
  }

  /// POST /auth/anonymous {device_id} -> {token, user_id, verified:false}
  Future<void> ensureAnonymous() async {
    state = state.copyWith(loading: true, error: null);
    try {
      final deviceId = await _deviceId();
      final json = await _api.postAnonymous(deviceId);
      final token = json['token'] as String?;
      final userId = json['user_id'] as String?;
      if (token == null || token.isEmpty) {
        throw StateError('Missing token from /auth/anonymous');
      }
      await _storage.write(key: _kJwtKey, value: token);
      if (userId != null) {
        await _storage.write(key: _kUserIdKey, value: userId);
      }
      await _storage.write(key: _kVerifiedKey, value: 'false');
      state = state.copyWith(
        token: token,
        userId: userId,
        verified: false,
        loading: false,
      );
    } catch (e) {
      state = state.copyWith(loading: false, error: e.toString());
      rethrow;
    }
  }

  /// POST /auth/send-code {phone|email}
  Future<void> sendCode({String? phone, String? email}) async {
    state = state.copyWith(loading: true, error: null);
    try {
      await _api.sendCode(phone: phone, email: email);
      state = state.copyWith(loading: false);
    } catch (e) {
      state = state.copyWith(loading: false, error: e.toString());
      rethrow;
    }
  }

  /// POST /auth/verify {phone|email, code} -> {token, verified:true}
  Future<void> verifyCode({
    String? phone,
    String? email,
    required String code,
  }) async {
    state = state.copyWith(loading: true, error: null);
    try {
      final json = await _api.verifyCode(
        phone: phone,
        email: email,
        code: code,
      );
      final token = json['token'] as String?;
      if (token == null || token.isEmpty) {
        throw StateError('Missing token from /auth/verify');
      }
      await _storage.write(key: _kJwtKey, value: token);
      await _storage.write(key: _kVerifiedKey, value: 'true');
      state = state.copyWith(token: token, verified: true, loading: false);
    } catch (e) {
      state = state.copyWith(loading: false, error: e.toString());
      rethrow;
    }
  }

  Future<void> signOut() async {
    await _storage.delete(key: _kJwtKey);
    await _storage.delete(key: _kUserIdKey);
    await _storage.write(key: _kVerifiedKey, value: 'false');
    state = const AuthState();
  }
}
