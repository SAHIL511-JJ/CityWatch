import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:image_picker/image_picker.dart';

import 'config.dart';

const _kJwtKey = 'jwt_token';

final secureStorageProvider = Provider<FlutterSecureStorage>((ref) {
  return const FlutterSecureStorage();
});

final dioProvider = Provider<Dio>((ref) {
  final dio = Dio(
    BaseOptions(
      baseUrl: AppConfig.baseUrl,
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 30),
      headers: const {'Content-Type': 'application/json'},
    ),
  );
  final storage = ref.watch(secureStorageProvider);
  dio.interceptors.add(
    InterceptorsWrapper(
      onRequest: (options, handler) async {
        final token = await storage.read(key: _kJwtKey);
        if (token != null && token.isNotEmpty) {
          options.headers['Authorization'] = 'Bearer $token';
        }
        return handler.next(options);
      },
    ),
  );
  return dio;
});

final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient(ref.watch(dioProvider));
});

class IncidentItem {
  IncidentItem({
    required this.id,
    required this.title,
    required this.description,
    required this.lat,
    required this.lng,
    this.address,
    this.photoUrl,
    this.status,
    this.severity,
    this.category,
    this.aiConfidence,
    this.aiReason,
    this.analysisVersion,
    this.createdAt,
  });

  factory IncidentItem.fromJson(Map<String, dynamic> json) {
    return IncidentItem(
      id: json['id'] as String,
      title: (json['title'] ?? '') as String,
      description: (json['description'] ?? '') as String,
      lat: (json['lat'] as num).toDouble(),
      lng: (json['lng'] as num).toDouble(),
      address: json['address'] as String?,
      photoUrl: (json['photo_url'] ?? json['photoUrl']) as String?,
      status: json['status'] as String?,
      severity: json['severity'] as String?,
      category: (json['ai_analysis'] is Map
          ? (json['ai_analysis'] as Map)['category'] as String?
          : null),
      aiConfidence: (json['ai_confidence'] as num?)?.toDouble(),
      aiReason: (json['ai_analysis'] is Map
          ? (json['ai_analysis'] as Map)['reason'] as String?
          : null),
      analysisVersion: (json['ai_analysis'] is Map
          ? (json['ai_analysis'] as Map)['analysis_version'] as String?
          : null),
      createdAt: json['created_at'] as String?,
    );
  }

  final String id;
  final String title;
  final String description;
  final double lat;
  final double lng;
  final String? address;
  final String? photoUrl;
  final String? status;
  final String? severity;
  final String? category;
  final double? aiConfidence;
  final String? aiReason;
  final String? analysisVersion;
  final String? createdAt;
}

class ApiClient {
  ApiClient(this._dio);

  final Dio _dio;

  Future<Map<String, dynamic>> postAnonymous(String deviceId) async {
    final res = await _dio.post<Map<String, dynamic>>(
      '/auth/anonymous',
      data: {'device_id': deviceId},
    );
    return res.data ?? <String, dynamic>{};
  }

  Future<void> sendCode({String? phone, String? email}) async {
    final data = <String, dynamic>{};
    if (phone != null && phone.isNotEmpty) data['phone'] = phone;
    if (email != null && email.isNotEmpty) data['email'] = email;
    await _dio.post<void>('/auth/send-code', data: data);
  }

  Future<Map<String, dynamic>> verifyCode({
    String? phone,
    String? email,
    required String code,
  }) async {
    final data = <String, dynamic>{'code': code};
    if (phone != null && phone.isNotEmpty) data['phone'] = phone;
    if (email != null && email.isNotEmpty) data['email'] = email;
    final res = await _dio.post<Map<String, dynamic>>(
      '/auth/verify',
      data: data,
    );
    return res.data ?? <String, dynamic>{};
  }

  /// POST /incidents as multipart(title, description, lat, lng, address?, photo).
  Future<Map<String, dynamic>> createIncident({
    required String title,
    required String description,
    required double lat,
    required double lng,
    String? address,
    XFile? photo,
  }) async {
    final form = FormData.fromMap({
      'title': title,
      'description': description,
      'lat': lat,
      'lng': lng,
      if (address != null && address.isNotEmpty) 'address': address,
      if (photo != null)
        'photo': await MultipartFile.fromFile(photo.path),
    });
    final res = await _dio.post<Map<String, dynamic>>(
      '/incidents',
      data: form,
    );
    return res.data ?? <String, dynamic>{};
  }

  /// Same as [createIncident] but takes raw bytes (web-safe, outbox retries).
  Future<Map<String, dynamic>> createIncidentBytes({
    required String title,
    required String description,
    required double lat,
    required double lng,
    String? address,
    required List<int> photoBytes,
    required String filename,
  }) async {
    final form = FormData.fromMap({
      'title': title,
      'description': description,
      'lat': lat,
      'lng': lng,
      if (address != null && address.isNotEmpty) 'address': address,
      'photo': MultipartFile.fromBytes(photoBytes, filename: filename),
    });
    final res = await _dio.post<Map<String, dynamic>>(
      '/incidents',
      data: form,
    );
    return res.data ?? <String, dynamic>{};
  }

  /// GET /incidents?lat&lng&radius_km&severity&category — verified only.
  Future<List<IncidentItem>> fetchFeed({
    required double lat,
    required double lng,
    double radiusKm = 10,
    String? severity,
    String? category,
    int limit = 50,
  }) async {
    final res = await _dio.get<List<dynamic>>(
      '/incidents',
      queryParameters: {
        'lat': lat,
        'lng': lng,
        'radius_km': radiusKm,
        'limit': limit,
        if (severity != null && severity.isNotEmpty) 'severity': severity,
        if (category != null && category.isNotEmpty) 'category': category,
      },
    );
    final list = res.data ?? <dynamic>[];
    return list
        .whereType<Map<String, dynamic>>()
        .map(IncidentItem.fromJson)
        // Client-side guard: feed shows verified only.
        .where((e) => e.status == null || e.status == 'verified')
        .toList();
  }

  Future<Map<String, dynamic>> fetchIncident(String id) async {
    final res = await _dio.get<Map<String, dynamic>>('/incidents/$id');
    return res.data ?? <String, dynamic>{};
  }

  /// Public photo URL for reels cards. Backend serves verified only, else 404.
  String photoUrlFor(String id) {
    return '${AppConfig.baseUrl}/incidents/$id/photo';
  }

  /// Raw photo bytes, null when missing. Results cached per session.
  /// Backend serves a ~70-byte 1px placeholder when no real photo exists —
  /// callers must treat tiny responses as "no photo" (see [hasRealPhoto]).
  final Map<String, List<int>?> _photoCache = {};

  Future<List<int>?> fetchPhotoBytes(String id) async {
    if (_photoCache.containsKey(id)) return _photoCache[id];
    try {
      final res = await _dio.get<List<int>>(
        '/incidents/$id/photo',
        options: Options(responseType: ResponseType.bytes),
      );
      final bytes = res.data;
      _photoCache[id] = bytes;
      return bytes;
    } on DioException catch (e) {
      if (e.response?.statusCode == 404) {
        _photoCache[id] = null;
        return null;
      }
      rethrow;
    }
  }

  /// True only for a real photo. Anything under 1KB is the 1px placeholder.
  static bool hasRealPhoto(List<int>? bytes) =>
      bytes != null && bytes.length > 1024;

  /// Stub: upload FCM token so backend can push nearby alerts.
  /// Wire to real endpoint (e.g. PATCH /users/me) once backend exposes it.
  Future<void> uploadFcmToken(String token) async {
    try {
      await _dio.post<void>(
        '/users/me/fcm-token',
        data: {'fcm_token': token},
      );
    } on DioException catch (e) {
      // Endpoint may not exist yet in MVP backend — swallow 404s.
      if (e.response?.statusCode != 404) rethrow;
    }
  }
}
