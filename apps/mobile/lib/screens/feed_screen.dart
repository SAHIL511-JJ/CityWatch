import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api_client.dart';

final _radiusKmProvider = StateProvider<double>((ref) => 10);
final _severityProvider = StateProvider<String>((ref) => '');

String _timeAgo(String? iso) {
  if (iso == null || iso.isEmpty) return '';
  final ms = DateTime.now().difference(DateTime.tryParse(iso) ?? DateTime.now());
  if (ms.inMinutes < 1) return 'just now';
  if (ms.inMinutes < 60) return '${ms.inMinutes}m ago';
  if (ms.inHours < 24) return '${ms.inHours}h ago';
  if (ms.inDays < 30) return '${ms.inDays}d ago';
  return iso.substring(0, 10);
}

String _distance(double lat1, double lng1, double lat2, double lng2) {
  final m = Geolocator.distanceBetween(lat1, lng1, lat2, lng2);
  if (m < 1000) return '${m.toStringAsFixed(0)}m';
  return '${(m / 1000).toStringAsFixed(1)}km';
}

Color _severityColor(String? severity) {
  switch (severity) {
    case 'critical':
      return Colors.red.shade800;
    case 'high':
      return Colors.deepOrange;
    case 'medium':
      return Colors.amber.shade800;
    default:
      return Colors.blueGrey;
  }
}

class FeedScreen extends ConsumerStatefulWidget {
  const FeedScreen({super.key});

  @override
  ConsumerState<FeedScreen> createState() => _FeedScreenState();
}

class _FeedScreenState extends ConsumerState<FeedScreen> {
  List<IncidentItem> _items = [];
  bool _loading = false;
  String? _error;
  Position? _pos;
  bool _gpsDenied = false;
  final _pager = PageController();

  @override
  void initState() {
    super.initState();
    Future.microtask(_refresh);
  }

  @override
  void dispose() {
    _pager.dispose();
    super.dispose();
  }

  Future<void> _refresh() async {
    setState(() {
      _loading = true;
      _error = null;
      _gpsDenied = false;
    });
    try {
      var perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) {
        perm = await Geolocator.requestPermission();
      }
      if (perm == LocationPermission.denied ||
          perm == LocationPermission.deniedForever) {
        if (!mounted) return;
        setState(() {
          _gpsDenied = true;
          _loading = false;
        });
        return;
      }
      final pos = await Geolocator.getCurrentPosition();
      final radius = ref.read(_radiusKmProvider);
      final sev = ref.read(_severityProvider);
      final items = await ref.read(apiClientProvider).fetchFeed(
            lat: pos.latitude,
            lng: pos.longitude,
            radiusKm: radius,
            severity: sev.isEmpty ? null : sev,
          );
      if (!mounted) return;
      setState(() {
        _pos = pos;
        _items = items;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _openInMaps(IncidentItem e) async {
    final url = Uri.parse(
        'https://www.google.com/maps/search/?api=1&query=${e.lat},${e.lng}');
    await launchUrl(url, mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    final radius = ref.watch(_radiusKmProvider);
    final severity = ref.watch(_severityProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Near you'),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            icon: const Icon(Icons.refresh),
            onPressed: _refresh,
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Row(
              children: [
                DropdownButton<double>(
                  value: radius,
                  items: const [5, 10, 25, 50]
                      .map((v) => DropdownMenuItem(
                          value: v.toDouble(), child: Text('${v}km')))
                      .toList(),
                  onChanged: (v) {
                    if (v != null) {
                      ref.read(_radiusKmProvider.notifier).state = v;
                      _refresh();
                    }
                  },
                ),
                const SizedBox(width: 12),
                DropdownButton<String>(
                  value: severity,
                  items: const [
                    DropdownMenuItem(value: '', child: Text('All')),
                    DropdownMenuItem(value: 'low', child: Text('Low')),
                    DropdownMenuItem(value: 'medium', child: Text('Medium')),
                    DropdownMenuItem(value: 'high', child: Text('High')),
                    DropdownMenuItem(
                        value: 'critical', child: Text('Critical')),
                  ],
                  onChanged: (v) {
                    ref.read(_severityProvider.notifier).state = v ?? '';
                    _refresh();
                  },
                ),
              ],
            ),
          ),
          Expanded(child: _body()),
        ],
      ),
    );
  }

  Widget _body() {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_gpsDenied) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('Location off — turn on GPS to see nearby reports.'),
              const SizedBox(height: 12),
              FilledButton(onPressed: _refresh, child: const Text('Retry')),
            ],
          ),
        ),
      );
    }
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('Failed to load feed:\n$_error'),
              const SizedBox(height: 12),
              FilledButton(onPressed: _refresh, child: const Text('Retry')),
            ],
          ),
        ),
      );
    }
    if (_items.isEmpty) {
      return const Center(child: Text('No reports near you yet.'));
    }
    return RefreshIndicator(
      onRefresh: _refresh,
      child: PageView.builder(
        controller: _pager,
        scrollDirection: Axis.vertical,
        itemCount: _items.length + 1,
        itemBuilder: (context, i) {
          if (i >= _items.length) {
            return const Center(child: Text("You're all caught up."));
          }
          return _reelCard(_items[i]);
        },
      ),
    );
  }

  Widget _photo(IncidentItem e) {
    final api = ref.read(apiClientProvider);
    return FutureBuilder<List<int>?>(
      future: api.fetchPhotoBytes(e.id),
      builder: (context, snap) {
        if (snap.connectionState == ConnectionState.waiting) {
          return Container(
            color: Colors.grey.shade200,
            child: const Center(child: CircularProgressIndicator()),
          );
        }
        final bytes = snap.data;
        if (!ApiClient.hasRealPhoto(bytes)) {
          return Container(
            color: Colors.grey.shade200,
            child: const Center(child: Text('Photo unavailable')),
          );
        }
        return Image.memory(Uint8List.fromList(bytes!), fit: BoxFit.cover);
      },
    );
  }

  Widget _reelCard(IncidentItem e) {
    final dist = _pos == null
        ? ''
        : _distance(_pos!.latitude, _pos!.longitude, e.lat, e.lng);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Expanded(
          child: _photo(e),
        ),
        Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: _severityColor(e.severity),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      (e.severity ?? 'low').toUpperCase(),
                      style: const TextStyle(color: Colors.white, fontSize: 12),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      e.title,
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                [_timeAgo(e.createdAt), dist, 'verified']
                    .where((s) => s.isNotEmpty)
                    .join(' . '),
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const SizedBox(height: 8),
              Text(e.description, maxLines: 3, overflow: TextOverflow.ellipsis),
              const SizedBox(height: 8),
              Row(
                children: [
                  TextButton.icon(
                    onPressed: () => _openInMaps(e),
                    icon: const Icon(Icons.map_outlined),
                    label: const Text('Open in Google Maps'),
                  ),
                  const Spacer(),
                  TextButton(
                    onPressed: () => _showDetail(e),
                    child: const Text('Details'),
                  ),
                ],
              ),
              const Center(
                child: Text('swipe up for next ^',
                    style: TextStyle(fontSize: 12, color: Colors.grey)),
              ),
            ],
          ),
        ),
      ],
    );
  }

  void _showDetail(IncidentItem e) {
    showModalBottomSheet<void>(
      context: context,
      builder: (context) => Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(e.title, style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),
            Text(e.description),
            const SizedBox(height: 8),
            Text('${e.lat.toStringAsFixed(5)}, ${e.lng.toStringAsFixed(5)}'),
            if (e.address != null && e.address!.isNotEmpty)
              Text(e.address!),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: () => _openInMaps(e),
              icon: const Icon(Icons.map_outlined),
              label: const Text('Open in Google Maps'),
            ),
          ],
        ),
      ),
    );
  }
}
