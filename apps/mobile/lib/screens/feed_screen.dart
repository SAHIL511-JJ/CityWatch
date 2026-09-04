import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';

import '../api_client.dart';

final _radiusKmProvider = StateProvider<double>((ref) => 10);
final _showMapProvider = StateProvider<bool>((ref) => true);

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

  @override
  void initState() {
    super.initState();
    Future.microtask(_refresh);
  }

  Future<Position?> _currentPosition() async {
    var perm = await Geolocator.checkPermission();
    if (perm == LocationPermission.denied) {
      perm = await Geolocator.requestPermission();
    }
    if (perm == LocationPermission.denied ||
        perm == LocationPermission.deniedForever) {
      return null;
    }
    return Geolocator.getCurrentPosition();
  }

  Future<void> _refresh() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      _pos ??= await _currentPosition();
      // Default center (city-agnostic) when GPS is unavailable.
      final lat = _pos?.latitude ?? 0.0;
      final lng = _pos?.longitude ?? 0.0;
      final radius = ref.read(_radiusKmProvider);
      final items = await ref.read(apiClientProvider).fetchFeed(
            lat: lat,
            lng: lng,
            radiusKm: radius,
          );
      if (!mounted) return;
      setState(() => _items = items);
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final showMap = ref.watch(_showMapProvider);
    final center = _pos != null
        ? LatLng(_pos!.latitude, _pos!.longitude)
        : const LatLng(0, 0);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Verified incidents'),
        actions: [
          IconButton(
            tooltip: showMap ? 'Show list' : 'Show map',
            icon: Icon(showMap ? Icons.list : Icons.map_outlined),
            onPressed: () =>
                ref.read(_showMapProvider.notifier).state = !showMap,
          ),
          IconButton(
            tooltip: 'Refresh',
            icon: const Icon(Icons.refresh),
            onPressed: _refresh,
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text('Failed to load feed:\n$_error'),
                        const SizedBox(height: 12),
                        FilledButton(
                          onPressed: _refresh,
                          child: const Text('Retry'),
                        ),
                      ],
                    ),
                  ),
                )
              : showMap
                  ? FlutterMap(
                      options: MapOptions(
                        initialCenter: center,
                        initialZoom: 13,
                      ),
                      children: [
                        TileLayer(
                          urlTemplate:
                              'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                          userAgentPackageName: 'incident_reporter',
                        ),
                        MarkerLayer(
                          markers: _items
                              .map(
                                (e) => Marker(
                                  point: LatLng(e.lat, e.lng),
                                  width: 40,
                                  height: 40,
                                  child: Tooltip(
                                    message: e.title,
                                    child: Icon(
                                      Icons.location_on,
                                      color: _severityColor(e.severity),
                                      size: 36,
                                    ),
                                  ),
                                ),
                              )
                              .toList(),
                        ),
                      ],
                    )
                  : ListView.separated(
                      itemCount: _items.length,
                      separatorBuilder: (_, __) => const Divider(height: 1),
                      itemBuilder: (context, i) {
                        final e = _items[i];
                        return ListTile(
                          leading: Icon(
                            Icons.warning_amber_rounded,
                            color: _severityColor(e.severity),
                          ),
                          title: Text(e.title),
                          subtitle: Text(
                            [e.severity, e.address]
                                .where(
                                  (s) => s != null && s.isNotEmpty,
                                )
                                .join(' · '),
                          ),
                          trailing: const Icon(Icons.chevron_right),
                          onTap: () =>
                              _showDetail(context, e),
                        );
                      },
                    ),
    );
  }

  void _showDetail(BuildContext context, IncidentItem e) {
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
          ],
        ),
      ),
    );
  }
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
