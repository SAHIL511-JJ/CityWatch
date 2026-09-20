import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api_client.dart';
import '../cw_theme.dart';
import '../taxonomy.dart';
import 'incident_detail_screen.dart';

class HotspotDetailScreen extends ConsumerStatefulWidget {
  const HotspotDetailScreen({
    super.key,
    required this.hotspot,
    this.onReport,
  });

  final HotspotItem hotspot;
  final VoidCallback? onReport;

  @override
  ConsumerState<HotspotDetailScreen> createState() =>
      _HotspotDetailScreenState();
}

class _HotspotDetailScreenState extends ConsumerState<HotspotDetailScreen> {
  Future<List<IncidentItem>>? _relatedFuture;

  Future<List<IncidentItem>> _loadRelated() async {
    final api = ref.read(apiClientProvider);
    final reports = await Future.wait(
      widget.hotspot.reportIds.take(8).map((id) async {
        try {
          return IncidentItem.fromJson(await api.fetchIncident(id));
        } catch (_) {
          return null;
        }
      }),
    );
    return reports.whereType<IncidentItem>().toList()
      ..sort((left, right) =>
          (right.createdAt ?? '').compareTo(left.createdAt ?? ''));
  }

  String _dateLabel(String? iso) {
    if (iso == null || iso.isEmpty) return 'Not available';
    final date = DateTime.tryParse(iso)?.toLocal();
    if (date == null) return 'Not available';
    return '${date.day}/${date.month}/${date.year}';
  }

  String _timeAgo(String? iso) {
    if (iso == null || iso.isEmpty) return '';
    final value = DateTime.tryParse(iso);
    if (value == null) return '';
    final difference = DateTime.now().difference(value);
    if (difference.inMinutes < 1) return 'Just now';
    if (difference.inMinutes < 60) return '${difference.inMinutes}m ago';
    if (difference.inHours < 24) return '${difference.inHours}h ago';
    if (difference.inDays < 30) return '${difference.inDays}d ago';
    return iso.substring(0, 10);
  }

  Color _trendColor(String trend) {
    switch (trend) {
      case 'rising':
        return CwColors.amber;
      case 'declining':
        return CwColors.pine;
      default:
        return CwColors.ink;
    }
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

  @override
  Widget build(BuildContext context) {
    _relatedFuture ??= _loadRelated();
    final hotspot = widget.hotspot;
    final trendColor = _trendColor(hotspot.trend);
    return Scaffold(
      appBar: AppBar(title: const Text('Signal details')),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 760),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(22, 14, 22, 32),
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: CwColors.mint,
                      borderRadius: BorderRadius.circular(18),
                    ),
                    child: Icon(
                      _categoryIcon(hotspot.category),
                      color: CwColors.pine,
                      size: 28,
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'RECURRING NEAR YOU',
                          style:
                              Theme.of(context).textTheme.bodySmall?.copyWith(
                                    color: CwColors.pine,
                                    fontWeight: FontWeight.w700,
                                    letterSpacing: 1.5,
                                  ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          environmentalCategoryLabel(hotspot.category),
                          style: Theme.of(context).textTheme.headlineSmall,
                        ),
                        const SizedBox(height: 8),
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: [
                            _chip(hotspot.trendLabel, trendColor, Colors.white),
                            _chip('Latest: ${hotspot.latestStatus}',
                                CwColors.mint, CwColors.pine),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 22),
              Container(
                padding: const EdgeInsets.all(18),
                decoration: BoxDecoration(
                  color: CwColors.mint.withValues(alpha: .62),
                  borderRadius: BorderRadius.circular(22),
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(Icons.auto_awesome_outlined,
                        color: CwColors.pine, size: 20),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        hotspot.explanation,
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 18),
              _statGrid(context, hotspot),
              const SizedBox(height: 18),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(18),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Location context',
                          style: Theme.of(context).textTheme.titleMedium),
                      const SizedBox(height: 8),
                      Text(
                        '${hotspot.centroidLat.toStringAsFixed(5)}, ${hotspot.centroidLng.toStringAsFixed(5)}',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      const SizedBox(height: 4),
                      const Text(
                          'This signal groups nearby verified observations so the neighborhood can understand what is repeating.'),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 24),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Related observations',
                          style: Theme.of(context).textTheme.titleLarge),
                      const SizedBox(height: 4),
                      Text('Open a report to see its public evidence record.',
                          style: Theme.of(context).textTheme.bodySmall),
                    ],
                  ),
                  Text('${hotspot.reportCount} total',
                      style: Theme.of(context).textTheme.bodySmall),
                ],
              ),
              const SizedBox(height: 12),
              FutureBuilder<List<IncidentItem>>(
                future: _relatedFuture,
                builder: (context, snapshot) {
                  if (snapshot.connectionState == ConnectionState.waiting) {
                    return const Padding(
                      padding: EdgeInsets.symmetric(vertical: 20),
                      child: Center(child: CircularProgressIndicator()),
                    );
                  }
                  if (snapshot.hasError) {
                    return _messageCard(
                      context,
                      'Reports are taking a moment',
                      'The signal is still available. Try loading its observations again.',
                      OutlinedButton(
                        onPressed: () => setState(() {
                          _relatedFuture = _loadRelated();
                        }),
                        child: const Text('Retry'),
                      ),
                    );
                  }
                  final reports = snapshot.data ?? const <IncidentItem>[];
                  if (reports.isEmpty) {
                    return _messageCard(
                      context,
                      'No public observations available',
                      'This signal is still being checked. You can add another observation when you are ready.',
                      const SizedBox.shrink(),
                    );
                  }
                  return Column(
                    children: reports
                        .map((report) => Padding(
                              padding: const EdgeInsets.only(bottom: 10),
                              child: _reportCard(context, report),
                            ))
                        .toList(),
                  );
                },
              ),
              const SizedBox(height: 10),
              FilledButton.icon(
                onPressed: widget.onReport,
                icon: const Icon(Icons.add_a_photo_outlined),
                label: const Text('Add an observation here'),
              ),
              const SizedBox(height: 8),
              Text(
                'Observed from ${_dateLabel(hotspot.firstObserved)} to ${_dateLabel(hotspot.lastObserved)}.',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _statGrid(BuildContext context, HotspotItem hotspot) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = (constraints.maxWidth - 12) / 2;
        return Wrap(
          spacing: 12,
          runSpacing: 12,
          children: [
            _stat(width, 'Reports', '${hotspot.reportCount}'),
            _stat(width, 'Contributors', '${hotspot.uniqueContributors}'),
            _stat(width, 'Mean spread',
                '${hotspot.meanDistanceKm.toStringAsFixed(2)} km'),
            _stat(width, 'Signal score', '${hotspot.persistenceScore}/100'),
          ],
        );
      },
    );
  }

  Widget _stat(double width, String label, String value) {
    return SizedBox(
      width: width,
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(value,
                  style: const TextStyle(
                      fontSize: 20, fontWeight: FontWeight.w800)),
              const SizedBox(height: 4),
              Text(label,
                  style: const TextStyle(color: CwColors.muted, fontSize: 12)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _reportCard(BuildContext context, IncidentItem report) {
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(24),
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) => IncidentDetailScreen(incident: report),
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: CwColors.mint,
                  borderRadius: BorderRadius.circular(14),
                ),
                child:
                    const Icon(Icons.visibility_outlined, color: CwColors.pine),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(report.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 4),
                    Text(
                      [
                        _timeAgo(report.createdAt),
                        report.status ?? 'verified',
                        report.address ?? 'Nearby observation',
                      ].where((value) => value.isNotEmpty).join(' · '),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
              const Icon(Icons.arrow_forward_ios_rounded,
                  size: 15, color: CwColors.pine),
            ],
          ),
        ),
      ),
    );
  }

  Widget _messageCard(
    BuildContext context,
    String title,
    String message,
    Widget action,
  ) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 6),
            Text(message),
            if (action is! SizedBox) ...[
              const SizedBox(height: 12),
              action,
            ],
          ],
        ),
      ),
    );
  }

  Widget _chip(String label, Color background, Color foreground) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(7),
      ),
      child: Text(label, style: TextStyle(color: foreground, fontSize: 12)),
    );
  }
}
