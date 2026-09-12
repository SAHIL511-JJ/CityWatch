import 'dart:async';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';

import '../api_client.dart';
import '../cw_theme.dart';
import '../feed_filters.dart';
import '../taxonomy.dart';
import 'hotspot_detail_screen.dart';
import 'incident_detail_screen.dart';

enum _FeedState { loading, denied, failed, offline, empty, ready }

enum _HotspotState { idle, loading, failed, empty, ready }

String _timeAgo(String? iso) {
  if (iso == null || iso.isEmpty) return '';
  final t = DateTime.tryParse(iso);
  if (t == null) return '';
  final d = DateTime.now().difference(t);
  if (d.inMinutes < 1) return 'just now';
  if (d.inMinutes < 60) return '${d.inMinutes}m ago';
  if (d.inHours < 24) return '${d.inHours}h ago';
  if (d.inDays < 30) return '${d.inDays}d ago';
  return iso.substring(0, 10);
}

String _distance(double lat1, double lng1, double lat2, double lng2) {
  final m = Geolocator.distanceBetween(lat1, lng1, lat2, lng2);
  if (m < 1000) return '${m.toStringAsFixed(0)}m';
  return '${(m / 1000).toStringAsFixed(1)}km';
}

class FeedScreen extends ConsumerStatefulWidget {
  const FeedScreen({super.key, this.onReport});
  final VoidCallback? onReport;

  @override
  ConsumerState<FeedScreen> createState() => _FeedScreenState();
}

class _FeedScreenState extends ConsumerState<FeedScreen> {
  List<IncidentItem> _items = [];
  List<HotspotItem> _hotspots = [];
  _FeedState _state = _FeedState.loading;
  _HotspotState _hotspotState = _HotspotState.idle;
  Position? _pos;
  DateTime? _posAt;
  bool _manualPos = false;
  final Map<String, Future<List<int>?>> _photos = {};

  @override
  void initState() {
    super.initState();
    Future.microtask(_refresh);
  }

  Future<Position> _locate() async {
    var perm = await Geolocator.checkPermission();
    if (perm == LocationPermission.denied) {
      perm = await Geolocator.requestPermission();
    }
    if (perm == LocationPermission.denied ||
        perm == LocationPermission.deniedForever) {
      throw const _Denied();
    }
    return Geolocator.getCurrentPosition(
      timeLimit: const Duration(seconds: 10),
    ).timeout(const Duration(seconds: 12));
  }

  Future<void> _refresh() async {
    setState(() {
      _state = _FeedState.loading;
      _hotspotState = _HotspotState.loading;
    });
    final usingManualPosition = _manualPos && _pos != null;
    late final Position pos;
    if (usingManualPosition) {
      pos = _pos!;
    } else {
      try {
        pos = await _locate();
      } on _Denied {
        if (!mounted) return;
        setState(() {
          _state = _FeedState.denied;
          _hotspotState = _HotspotState.idle;
        });
        return;
      } on TimeoutException {
        if (!mounted) return;
        setState(() {
          _state = _FeedState.failed;
          _hotspotState = _HotspotState.idle;
        });
        return;
      } catch (e) {
        if (!mounted) return;
        setState(() {
          _state = _FeedState.failed;
          _hotspotState = _HotspotState.idle;
        });
        return;
      }
    }
    await _loadAtPosition(pos, usingManualPosition: usingManualPosition);
  }

  Future<void> _loadAtPosition(
    Position pos, {
    required bool usingManualPosition,
  }) async {
    final api = ref.read(apiClientProvider);
    final severity = ref.read(severityFilterProvider);
    final category = ref.read(categoryFilterProvider);
    if (!mounted) return;
    setState(() {
      _pos = pos;
      _posAt = DateTime.now();
      _manualPos = usingManualPosition;
      _state = _FeedState.loading;
      _hotspotState = _HotspotState.loading;
    });

    final feedFuture = api.fetchFeed(
      lat: pos.latitude,
      lng: pos.longitude,
      radiusKm: ref.read(radiusKmProvider),
      severity: severity.isEmpty ? null : severity,
      category: category.isEmpty ? null : category,
    );
    final hotspotsFuture = api.fetchHotspots(
      lat: pos.latitude,
      lng: pos.longitude,
      radiusKm: ref.read(radiusKmProvider),
      category: category.isEmpty ? null : category,
      severity: severity.isEmpty ? null : severity,
    );

    try {
      final items = await feedFuture;
      if (!mounted) return;
      setState(() {
        _items = items;
        _state = items.isEmpty ? _FeedState.empty : _FeedState.ready;
      });
    } on DioException catch (e) {
      if (!mounted) return;
      final offline = e.type == DioExceptionType.connectionError ||
          e.type == DioExceptionType.connectionTimeout ||
          e.type == DioExceptionType.unknown;
      setState(() {
        _state = offline ? _FeedState.offline : _FeedState.failed;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _state = _FeedState.failed);
    }

    try {
      final hotspots = await hotspotsFuture;
      if (!mounted) return;
      setState(() {
        _hotspots = hotspots;
        _hotspotState =
            hotspots.isEmpty ? _HotspotState.empty : _HotspotState.ready;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _hotspotState = _HotspotState.failed);
    }
  }

  Future<void> _enterLocationManually() async {
    final latC = TextEditingController(
        text: _pos == null ? '' : _pos!.latitude.toStringAsFixed(5));
    final lngC = TextEditingController(
        text: _pos == null ? '' : _pos!.longitude.toStringAsFixed(5));
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Enter location'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: latC,
              keyboardType: const TextInputType.numberWithOptions(
                  decimal: true, signed: true),
              decoration: const InputDecoration(
                  labelText: 'Latitude', hintText: '18.5196'),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: lngC,
              keyboardType: const TextInputType.numberWithOptions(
                  decimal: true, signed: true),
              decoration: const InputDecoration(
                  labelText: 'Longitude', hintText: '73.8554'),
            ),
          ],
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(c, false),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.pop(c, true),
              child: const Text('Use this')),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    final lat = double.tryParse(latC.text.trim());
    final lng = double.tryParse(lngC.text.trim());
    if (lat == null || lng == null || lat.abs() > 90 || lng.abs() > 180) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
              content: Text('Enter valid coords, e.g. 18.5196, 73.8554.')),
        );
      }
      return;
    }
    setState(() {
      _pos = Position(
        latitude: lat,
        longitude: lng,
        timestamp: DateTime.now(),
        accuracy: 0,
        altitude: 0,
        altitudeAccuracy: 0,
        heading: 0,
        headingAccuracy: 0,
        speed: 0,
        speedAccuracy: 0,
      );
      _manualPos = true;
      _posAt = DateTime.now();
      _state = _FeedState.loading;
    });
    await _loadAtPosition(
      _pos!,
      usingManualPosition: true,
    );
  }

  @override
  Widget build(BuildContext context) {
    final radius = ref.watch(radiusKmProvider);
    final severity = ref.watch(severityFilterProvider);
    final category = ref.watch(categoryFilterProvider);
    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: false,
        title: Row(children: [
          Container(
            padding: const EdgeInsets.all(9),
            decoration: BoxDecoration(
                color: CwColors.pine, borderRadius: BorderRadius.circular(13)),
            child:
                const Icon(Icons.radar_rounded, color: Colors.white, size: 23),
          ),
          const SizedBox(width: 10),
          const Flexible(
              child: FittedBox(
            fit: BoxFit.scaleDown,
            child: Text('citywatch',
                style: TextStyle(
                    fontSize: 23,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -1)),
          )),
        ]),
        actions: [
          IconButton.filledTonal(
            tooltip: 'Refresh nearby reports',
            icon: const Icon(Icons.refresh_rounded, size: 22),
            onPressed: _state == _FeedState.loading ? null : _refresh,
          ),
          const SizedBox(width: 16),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: CustomScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(22, 14, 22, 22),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const CwPageIntro(
                      eyebrow: 'A little awareness. A better city.',
                      title: 'Around your\nneighborhood.',
                      description: 'Stay informed. Look out for each other.',
                    ),
                    const SizedBox(height: 24),
                    Material(
                      color: CwColors.mint,
                      borderRadius: BorderRadius.circular(22),
                      clipBehavior: Clip.antiAlias,
                      child: InkWell(
                        onTap: widget.onReport,
                        child: Padding(
                          padding: const EdgeInsets.all(18),
                          child: Row(children: [
                            Container(
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(
                                  color: CwColors.paper.withValues(alpha: .65),
                                  borderRadius: BorderRadius.circular(16)),
                              child: const Icon(Icons.add_a_photo_outlined,
                                  color: CwColors.pine, size: 25),
                            ),
                            const SizedBox(width: 14),
                            Expanded(
                                child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('See something? Share it.',
                                    style: Theme.of(context)
                                        .textTheme
                                        .titleMedium),
                                const SizedBox(height: 4),
                                Text('A photo can make a difference.',
                                    style:
                                        Theme.of(context).textTheme.bodySmall),
                              ],
                            )),
                            const SizedBox(width: 8),
                            const Icon(Icons.arrow_forward_rounded,
                                size: 20, color: CwColors.pine),
                          ]),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            SliverToBoxAdapter(child: _filterBar(radius, severity, category)),
            SliverToBoxAdapter(child: _gpsStrip()),
            SliverToBoxAdapter(child: _hotspotSection()),
            if (_state == _FeedState.ready) ...[
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 0),
                sliver: SliverList.builder(
                  itemCount: _items.length,
                  itemBuilder: (_, i) => Padding(
                    padding: const EdgeInsets.only(bottom: 18),
                    child: _card(_items[i]),
                  ),
                ),
              ),
              const SliverToBoxAdapter(
                  child: Padding(
                padding: EdgeInsets.fromLTRB(20, 10, 20, 30),
                child: Text('You’re all caught up. Thanks for looking out.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: CwColors.muted, fontSize: 12)),
              )),
            ] else
              SliverToBoxAdapter(child: _body()),
          ],
        ),
      ),
    );
  }

  Widget _filterBar(double radius, String severity, String category) {
    const radiusOptions = [5.0, 10.0, 25.0, 50.0];
    var shown = radiusOptions.first;
    for (final o in radiusOptions) {
      if ((radius - o).abs() < (radius - shown).abs()) shown = o;
    }
    return Container(
      color: Theme.of(context).colorScheme.surface,
      padding: const EdgeInsets.fromLTRB(22, 0, 22, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: 8,
            runSpacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              _filterDropdown<double>(
                icon: Icons.radar_outlined,
                value: shown,
                label: '${shown.toStringAsFixed(0)} km',
                items: const [5, 10, 25, 50]
                    .map((v) => DropdownMenuItem(
                        value: v.toDouble(), child: Text('${v}km')))
                    .toList(),
                onChanged: (v) {
                  if (v != null) {
                    ref.read(radiusKmProvider.notifier).state = v;
                    if (_pos != null) _refresh();
                  }
                },
              ),
              const SizedBox(width: 8),
              _filterDropdown<String>(
                icon: Icons.tune,
                value: severity,
                label: severityLabel(severity),
                items: feedSeverities
                    .map((s) => DropdownMenuItem(
                        value: s, child: Text(severityLabel(s))))
                    .toList(),
                onChanged: (v) {
                  ref.read(severityFilterProvider.notifier).state = v ?? '';
                  if (_pos != null) _refresh();
                },
              ),
              Text(
                _state == _FeedState.ready
                    ? '${_items.length} nearby'
                    : 'Nearby reports',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          ),
          const SizedBox(height: 14),
          Text(
            'Browse by type',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: CwColors.ink,
                  fontWeight: FontWeight.w700,
                ),
          ),
          const SizedBox(height: 8),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: feedCategories.map((c) {
                final sel = category == c;
                return Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    showCheckmark: false,
                    labelStyle: TextStyle(
                        color: sel ? Colors.white : CwColors.ink,
                        fontWeight: FontWeight.w600,
                        fontSize: 12),
                    avatar: Icon(c.isEmpty ? Icons.apps : _categoryIcon(c),
                        size: 16, color: sel ? Colors.white : CwColors.pine),
                    label: Text(categoryLabel(c)),
                    selected: sel,
                    onSelected: (_) {
                      ref.read(categoryFilterProvider.notifier).state = c;
                      if (_pos != null) _refresh();
                    },
                  ),
                );
              }).toList(),
            ),
          ),
        ],
      ),
    );
  }

  Widget _filterDropdown<T>({
    required IconData icon,
    required T value,
    required String label,
    required List<DropdownMenuItem<T>> items,
    required ValueChanged<T?> onChanged,
  }) {
    return Container(
      height: 48,
      padding: const EdgeInsets.only(left: 10),
      decoration: BoxDecoration(
        color: CwColors.cream,
        borderRadius: BorderRadius.circular(11),
        border: Border.all(color: CwColors.sand),
      ),
      child: PopupMenuButton<T>(
        tooltip: label,
        color: CwColors.paper,
        elevation: 10,
        offset: const Offset(0, 8),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: const BorderSide(color: CwColors.sand),
        ),
        onSelected: onChanged,
        itemBuilder: (_) => items
            .map(
              (item) => PopupMenuItem<T>(
                value: item.value,
                height: 44,
                child: Row(
                  children: [
                    Expanded(child: item.child),
                    if (item.value == value)
                      const Icon(Icons.check_rounded,
                          size: 18, color: CwColors.pine),
                  ],
                ),
              ),
            )
            .toList(),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 16, color: CwColors.pine),
            const SizedBox(width: 7),
            Text(label, style: const TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(width: 4),
            const Icon(Icons.expand_more, size: 18),
          ],
        ),
      ),
    );
  }

  IconData _categoryIcon(String category) {
    switch (category) {
      case 'flooding':
      case 'waterlogging':
        return Icons.water_drop_outlined;
      case 'blocked_drain':
        return Icons.plumbing_outlined;
      case 'waste':
        return Icons.delete_sweep_outlined;
      case 'sewage':
        return Icons.water_damage_outlined;
      case 'plastic':
        return Icons.recycling_outlined;
      case 'pollution':
        return Icons.air_outlined;
      case 'damaged_infrastructure':
        return Icons.construction_outlined;
      default:
        return Icons.eco_outlined;
    }
  }

  Widget _gpsStrip() {
    if (_pos == null) return const SizedBox.shrink();
    final age = _posAt == null ? null : DateTime.now().difference(_posAt!);
    final stale = age != null && age.inSeconds > 60;
    final acc = _pos!.accuracy;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 2),
      color: stale ? Colors.amber.shade100 : Colors.transparent,
      child: Row(
        children: [
          Expanded(
            child: Text(
              _manualPos
                  ? 'Manual location${stale ? ' · stale, re-locate' : ''}'
                  : acc > 0
                      ? 'GPS ±${acc.toStringAsFixed(0)}m${stale ? ' · stale, re-locate' : ''}'
                      : 'GPS location${stale ? ' · stale, re-locate' : ''}',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
          TextButton.icon(
            onPressed: _refresh,
            icon: const Icon(Icons.my_location, size: 16),
            label: const Text('Re-locate'),
          ),
          TextButton(
            onPressed: _enterLocationManually,
            child: const Text('Edit'),
          ),
        ],
      ),
    );
  }

  Widget _hotspotSection() {
    if (_pos == null || _hotspotState == _HotspotState.idle) {
      return const SizedBox.shrink();
    }
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 14, 20, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'AWARENESS',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: CwColors.pine,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 1.5,
                          ),
                    ),
                    const SizedBox(height: 5),
                    Text('Recurring near you',
                        style: Theme.of(context).textTheme.titleLarge),
                  ],
                ),
              ),
              if (_hotspotState == _HotspotState.ready)
                Flexible(
                  child: Text(
                      '${_hotspots.length} signal${_hotspots.length == 1 ? '' : 's'}',
                      textAlign: TextAlign.right,
                      style: Theme.of(context).textTheme.bodySmall),
                ),
            ],
          ),
          const SizedBox(height: 10),
          switch (_hotspotState) {
            _HotspotState.loading => _hotspotLoading(),
            _HotspotState.failed => _hotspotMessage(
                'Signals are taking a moment',
                'We could not load recurring conditions. Your nearby reports are still available.',
                OutlinedButton(
                  onPressed: _refresh,
                  child: const Text('Retry signals'),
                ),
              ),
            _HotspotState.empty => _hotspotMessage(
                'No recurring signals yet',
                'There are no verified patterns near this location. You can still share what you see.',
                const SizedBox.shrink(),
              ),
            _HotspotState.ready => Column(
                children: _hotspots
                    .take(4)
                    .map((hotspot) => Padding(
                          padding: const EdgeInsets.only(bottom: 10),
                          child: _hotspotCard(hotspot),
                        ))
                    .toList(),
              ),
            _HotspotState.idle => const SizedBox.shrink(),
          },
        ],
      ),
    );
  }

  Widget _hotspotLoading() {
    return Column(
      children: [
        for (var i = 0; i < 2; i++)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(height: 14, width: 150, color: CwColors.mint),
                    const SizedBox(height: 10),
                    Container(
                        height: 12,
                        width: double.infinity,
                        color: CwColors.cream),
                    const SizedBox(height: 7),
                    Container(height: 12, width: 220, color: CwColors.cream),
                  ],
                ),
              ),
            ),
          ),
      ],
    );
  }

  Widget _hotspotMessage(String title, String message, Widget action) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 5),
            Text(message, style: Theme.of(context).textTheme.bodySmall),
            if (action is! SizedBox) ...[
              const SizedBox(height: 10),
              action,
            ],
          ],
        ),
      ),
    );
  }

  Widget _hotspotCard(HotspotItem hotspot) {
    final trendColor =
        hotspot.trend == 'rising' ? CwColors.amber : CwColors.pine;
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) => HotspotDetailScreen(
              hotspot: hotspot,
              onReport: () {
                Navigator.of(context).pop();
                widget.onReport?.call();
              },
            ),
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(11),
                decoration: BoxDecoration(
                  color: CwColors.mint,
                  borderRadius: BorderRadius.circular(15),
                ),
                child: Icon(
                  _categoryIcon(hotspot.category),
                  color: CwColors.pine,
                  size: 23,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            environmentalCategoryLabel(hotspot.category),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                        ),
                        _chip(hotspot.trendLabel, trendColor, Colors.white),
                      ],
                    ),
                    const SizedBox(height: 5),
                    Text(
                      '${hotspot.reportCount} observation${hotspot.reportCount == 1 ? '' : 's'} · ${hotspot.meanDistanceKm.toStringAsFixed(2)} km spread',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                    const SizedBox(height: 5),
                    Text(
                      hotspot.explanation,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              const Icon(Icons.arrow_forward_ios_rounded,
                  size: 15, color: CwColors.pine),
            ],
          ),
        ),
      ),
    );
  }

  Widget _body() {
    switch (_state) {
      case _FeedState.loading:
        return ListView.separated(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: 2,
          separatorBuilder: (_, __) => const SizedBox(height: 8),
          padding: const EdgeInsets.all(20),
          itemBuilder: (_, __) => Card(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  ClipRRect(
                      borderRadius: BorderRadius.circular(16),
                      child: const LinearProgressIndicator(
                          minHeight: 150,
                          backgroundColor: CwColors.mint,
                          color: CwColors.sand)),
                  const SizedBox(height: 8),
                  Container(
                      height: 16, width: 180, color: Colors.grey.shade300),
                  const SizedBox(height: 6),
                  Container(
                      height: 12,
                      width: double.infinity,
                      color: Colors.grey.shade200),
                ],
              ),
            ),
          ),
        );
      case _FeedState.denied:
        return _stateCard(
          'Location permission off',
          'Turn on location to see nearby reports — or enter it by hand.',
          [
            FilledButton(onPressed: _refresh, child: const Text('Retry')),
            OutlinedButton(
                onPressed: _enterLocationManually,
                child: const Text('Enter location manually')),
          ],
        );
      case _FeedState.failed:
        return _stateCard(
          'Let’s find your neighborhood',
          'We couldn’t load nearby reports. Try again or choose a location manually.',
          [
            FilledButton(onPressed: _refresh, child: const Text('Retry')),
            OutlinedButton(
                onPressed: _enterLocationManually,
                child: const Text('Enter location manually')),
          ],
        );
      case _FeedState.offline:
        return _stateCard(
          'You are offline',
          'Check your connection, then retry. Your reports stay safe.',
          [FilledButton(onPressed: _refresh, child: const Text('Retry'))],
        );
      case _FeedState.empty:
        return _stateCard(
          'No reports near you yet',
          'Be the first to report — it takes a minute.',
          [
            OutlinedButton(
                onPressed: _enterLocationManually,
                child: const Text('Try another spot')),
          ],
        );
      case _FeedState.ready:
        return RefreshIndicator(
          onRefresh: _refresh,
          child: ListView.separated(
            itemCount: _items.length + 1,
            separatorBuilder: (_, __) => const SizedBox(height: 8),
            padding: const EdgeInsets.all(12),
            itemBuilder: (context, i) {
              if (i >= _items.length) {
                return const Padding(
                  padding: EdgeInsets.symmetric(vertical: 16),
                  child: Center(child: Text("You're all caught up.")),
                );
              }
              return _card(_items[i]);
            },
          ),
        );
    }
  }

  Widget _stateCard(String title, String sub, List<Widget> actions) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const NeighborhoodArt(height: 145),
            const SizedBox(height: 18),
            Text(title, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            Text(sub, textAlign: TextAlign.center),
            const SizedBox(height: 16),
            Wrap(
                spacing: 8,
                runSpacing: 8,
                alignment: WrapAlignment.center,
                children: actions),
          ],
        ),
      ),
    );
  }

  Widget _card(IncidentItem e) {
    final dist = _pos == null
        ? ''
        : _distance(_pos!.latitude, _pos!.longitude, e.lat, e.lng);
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => _showDetail(e),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Stack(children: [
              SizedBox(
                  height: 190, width: double.infinity, child: _thumb(e.id)),
              Positioned(
                top: 14,
                left: 14,
                child: _chip('${(e.severity ?? 'low').toUpperCase()} PRIORITY',
                    severityColor(e.severity), Colors.white),
              ),
              Positioned(
                bottom: 14,
                right: 14,
                child: _chip(
                  e.status == 'awaiting_verification'
                      ? 'Needs community verification'
                      : 'Verified',
                  e.status == 'awaiting_verification'
                      ? const Color(0xFFFFF0C2)
                      : CwColors.paper,
                  CwColors.pine,
                ),
              ),
            ]),
            Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                        [
                          _timeAgo(e.createdAt),
                          if (dist.isNotEmpty) '$dist away'
                        ].where((s) => s.isNotEmpty).join('  ·  '),
                        style: Theme.of(context).textTheme.bodySmall),
                    const SizedBox(height: 9),
                    Text(e.title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context)
                            .textTheme
                            .titleLarge
                            ?.copyWith(fontSize: 20, height: 1.3)),
                    if (e.category != null) ...[
                      const SizedBox(height: 8),
                      Align(
                        alignment: Alignment.centerLeft,
                        child: _chip(environmentalCategoryLabel(e.category!),
                            CwColors.mint, CwColors.pine),
                      ),
                    ],
                    const SizedBox(height: 8),
                    Text(e.description,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            color: CwColors.muted, height: 1.5)),
                    const SizedBox(height: 18),
                    const Divider(height: 1),
                    const SizedBox(height: 14),
                    Row(children: [
                      const Icon(Icons.location_on_outlined,
                          size: 17, color: CwColors.pine),
                      const SizedBox(width: 6),
                      Expanded(
                          child: Text(
                              e.address?.isNotEmpty == true
                                  ? e.address!
                                  : 'Nearby observation',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: Theme.of(context).textTheme.bodySmall)),
                      const SizedBox(width: 12),
                      const Text('View report',
                          style: TextStyle(
                              color: CwColors.pine,
                              fontSize: 12,
                              fontWeight: FontWeight.w700)),
                      const SizedBox(width: 6),
                      const Icon(Icons.arrow_forward_rounded,
                          size: 16, color: CwColors.pine),
                    ]),
                  ]),
            ),
          ],
        ),
      ),
    );
  }

  Widget _thumb(String id) {
    final api = ref.read(apiClientProvider);
    return FutureBuilder<List<int>?>(
      future: _photos.putIfAbsent(id, () => api.fetchPhotoBytes(id)),
      builder: (context, snap) {
        if (snap.connectionState == ConnectionState.waiting) {
          return const ColoredBox(
              color: CwColors.mint,
              child: Center(child: CircularProgressIndicator(strokeWidth: 2)));
        }
        if (!ApiClient.hasRealPhoto(snap.data)) {
          return Container(
            color: CwColors.mint.withValues(alpha: .5),
            child: const Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.photo_outlined, color: CwColors.pine, size: 32),
                  SizedBox(height: 8),
                  Text('Photo unavailable',
                      style: TextStyle(color: CwColors.muted, fontSize: 12)),
                ]),
          );
        }
        return Image.memory(
          Uint8List.fromList(snap.data!),
          fit: BoxFit.cover,
          errorBuilder: (_, __, ___) => Container(
            color: Colors.grey.shade200,
            child: const Icon(Icons.broken_image_outlined, color: Colors.grey),
          ),
        );
      },
    );
  }

  void _showDetail(IncidentItem e) {
    final dist = _pos == null
        ? ''
        : _distance(_pos!.latitude, _pos!.longitude, e.lat, e.lng);
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => IncidentDetailScreen(
          incident: e,
          distanceLabel: dist,
        ),
      ),
    );
  }

  Widget _chip(String label, Color bg, Color fg) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration:
          BoxDecoration(color: bg, borderRadius: BorderRadius.circular(6)),
      child: Text(label, style: TextStyle(color: fg, fontSize: 12)),
    );
  }
}

class _Denied implements Exception {
  const _Denied();
}
