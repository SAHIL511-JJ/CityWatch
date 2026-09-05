import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'api_client.dart';

const _kOutboxKey = 'outbox_v1';

/// Offline outbox (KAN-28): reports that couldn't send are queued locally
/// with the photo embedded, then auto-retried. Never leaks exceptions —
/// callers get human copy via [OutboxResult].
class OutboxItem {
  OutboxItem({
    required this.id,
    required this.title,
    required this.description,
    this.address,
    required this.lat,
    required this.lng,
    required this.photoBase64,
    required this.filename,
    required this.createdAt,
    this.state = 'queued',
    this.remoteId,
    this.error,
  });

  factory OutboxItem.fromJson(Map<String, dynamic> j) => OutboxItem(
        id: j['id'] as String,
        title: j['title'] as String? ?? '',
        description: j['description'] as String? ?? '',
        address: j['address'] as String?,
        lat: (j['lat'] as num).toDouble(),
        lng: (j['lng'] as num).toDouble(),
        photoBase64: j['photoBase64'] as String? ?? '',
        filename: j['filename'] as String? ?? 'photo.jpg',
        createdAt: j['createdAt'] as String? ?? '',
        state: j['state'] as String? ?? 'queued',
        remoteId: j['remoteId'] as String?,
        error: j['error'] as String?,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        'description': description,
        'address': address,
        'lat': lat,
        'lng': lng,
        'photoBase64': photoBase64,
        'filename': filename,
        'createdAt': createdAt,
        'state': state,
        'remoteId': remoteId,
        'error': error,
      };

  final String id;
  final String title;
  final String description;
  final String? address;
  final double lat;
  final double lng;
  final String photoBase64;
  final String filename;
  final String createdAt;
  final String state;
  final String? remoteId;
  final String? error;

  OutboxItem copyWith({String? state, String? remoteId, String? error}) =>
      OutboxItem(
        id: id,
        title: title,
        description: description,
        address: address,
        lat: lat,
        lng: lng,
        photoBase64: photoBase64,
        filename: filename,
        createdAt: createdAt,
        state: state ?? this.state,
        remoteId: remoteId ?? this.remoteId,
        error: error,
      );
}

final outboxProvider =
    StateNotifierProvider<OutboxNotifier, List<OutboxItem>>((ref) {
  return OutboxNotifier(
    ref.watch(apiClientProvider),
    ref.watch(secureStorageProvider),
  );
});

class OutboxNotifier extends StateNotifier<List<OutboxItem>> {
  OutboxNotifier(this._api, this._storage) : super([]) {
    load();
  }

  final ApiClient _api;
  final FlutterSecureStorage _storage;

  Future<void> load() async {
    final raw = await _storage.read(key: _kOutboxKey);
    if (raw == null || raw.isEmpty) return;
    try {
      final list = (jsonDecode(raw) as List)
          .whereType<Map<String, dynamic>>()
          .map(OutboxItem.fromJson)
          .toList();
      state = list;
    } catch (_) {
      state = [];
    }
  }

  Future<void> _save() async {
    await _storage.write(
        key: _kOutboxKey,
        value: jsonEncode(state.map((e) => e.toJson()).toList()));
  }

  Future<void> enqueue(OutboxItem item) async {
    state = [...state, item];
    await _save();
  }

  Future<void> remove(String id) async {
    state = state.where((e) => e.id != id).toList();
    await _save();
  }

  static bool _isOffline(DioException e) =>
      e.type == DioExceptionType.connectionError ||
      e.type == DioExceptionType.connectionTimeout ||
      e.type == DioExceptionType.unknown;

  static String humanError(Object e) {
    if (e is DioException) {
      if (_isOffline(e)) return 'No connection right now.';
      final code = e.response?.statusCode;
      if (code == 400) return 'Something in the report was rejected — check the photo.';
      if (code == 403) return 'This account cannot report right now.';
      if (code == 413) return 'Photo is too large.';
    }
    return 'Could not send. Try again in a bit.';
  }

  /// Sends one queued item. Returns null on success, human error otherwise.
  Future<String?> sendOne(OutboxItem item) async {
    _replace(item.id, item.copyWith(state: 'sending', error: null));
    try {
      final res = await _api.createIncidentBytes(
        title: item.title,
        description: item.description,
        lat: item.lat,
        lng: item.lng,
        address: item.address,
        photoBytes: base64Decode(item.photoBase64),
        filename: item.filename,
      );
      _replace(item.id,
          item.copyWith(state: 'sent', remoteId: res['id'] as String?));
      return null;
    } on DioException catch (e) {
      _replace(item.id,
          item.copyWith(state: 'failed', error: humanError(e)));
      return humanError(e);
    } catch (_) {
      _replace(item.id,
          item.copyWith(state: 'failed', error: humanError('x')));
      return humanError('x');
    }
  }

  Future<void> retryAll() async {
    for (final item in List<OutboxItem>.from(state)) {
      if (item.state == 'sent') continue;
      await sendOne(item);
    }
  }

  void _replace(String id, OutboxItem next) {
    state = [for (final e in state) if (e.id == id) next else e];
    _save();
  }
}
