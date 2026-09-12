import 'dart:typed_data';

import 'package:flutter/services.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api_client.dart';
import '../cw_theme.dart';
import '../taxonomy.dart';
import 'resolution_detail_screen.dart';

class IncidentDetailScreen extends ConsumerStatefulWidget {
  const IncidentDetailScreen({
    super.key,
    required this.incident,
    this.distanceLabel,
  });

  final IncidentItem incident;
  final String? distanceLabel;

  @override
  ConsumerState<IncidentDetailScreen> createState() =>
      _IncidentDetailScreenState();
}

class _IncidentDetailScreenState
    extends ConsumerState<IncidentDetailScreen> {
  late Future<Map<String, dynamic>?> _resolutionFuture;

  IncidentItem get incident => widget.incident;

  @override
  void initState() {
    super.initState();
    _resolutionFuture =
        ref.read(apiClientProvider).fetchResolutionIfAvailable(incident.id);
  }

  void _reloadResolution() {
    setState(() {
      _resolutionFuture =
          ref.read(apiClientProvider).fetchResolutionIfAvailable(incident.id);
    });
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

  Future<void> _openInMaps() async {
    final url = Uri.parse(
      'https://www.google.com/maps/search/?api=1&query=${incident.lat},${incident.lng}',
    );
    await launchUrl(url, mode: LaunchMode.externalApplication);
  }

  Future<void> _openResolution() async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => ResolutionDetailScreen(
          incidentId: incident.id,
          source: ResolutionScreenSource.community,
        ),
      ),
    );
    if (mounted) _reloadResolution();
  }

  String _statusLabel(String status) {
    switch (status) {
      case 'awaiting_verification':
        return 'NEEDS COMMUNITY VERIFICATION';
      case 'community_confirmed':
        return 'COMMUNITY CONFIRMED';
      case 'needs_follow_up':
        return 'NEEDS FOLLOW-UP';
      default:
        return status.replaceAll('_', ' ').toUpperCase();
    }
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'awaiting_verification':
        return const Color(0xFFB7791F);
      case 'community_confirmed':
        return CwColors.pine;
      case 'needs_follow_up':
        return const Color(0xFFC05621);
      default:
        return Colors.green.shade700;
    }
  }

  Widget _resolutionCard(
    BuildContext context, {
    required String status,
    required ResolutionEvidenceItem? authority,
    required bool loading,
    required bool failed,
  }) {
    if (loading) {
      return Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: CwColors.mint.withValues(alpha: .45),
          borderRadius: BorderRadius.circular(18),
        ),
        child: const Row(
          children: [
            SizedBox(
              height: 18,
              width: 18,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
            SizedBox(width: 10),
            Text('Checking for resolution updates…'),
          ],
        ),
      );
    }
    if (failed) {
      return Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: CwColors.paper,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: CwColors.sand),
        ),
        child: Row(
          children: [
            const Expanded(child: Text('Resolution update unavailable.')),
            TextButton(onPressed: _reloadResolution, child: const Text('Retry')),
          ],
        ),
      );
    }
    if (status == 'awaiting_verification') {
      return Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: const Color(0xFFFFF7E6),
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: const Color(0xFFF1D59B)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Help verify this resolution',
                style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 6),
            const Text(
                'An authority reported an action. Add one current photo and a short note from a safe distance so the community can help confirm the outcome.'),
            if (authority != null && authority.note.isNotEmpty) ...[
              const SizedBox(height: 10),
              Text('Authority update: ${authority.note}',
                  style: Theme.of(context).textTheme.bodySmall),
            ],
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: _openResolution,
              icon: const Icon(Icons.groups_outlined),
              label: const Text('Verify this resolution'),
            ),
          ],
        ),
      );
    }
    if (status == 'community_confirmed') {
      return _statusCard(
        context,
        icon: Icons.verified_outlined,
        title: 'Community confirmed',
        message: 'Neighbors confirmed that the authority action addressed the issue.',
        action: OutlinedButton.icon(
          onPressed: _openResolution,
          icon: const Icon(Icons.visibility_outlined),
          label: const Text('View resolution'),
        ),
      );
    }
    if (status == 'needs_follow_up') {
      return _statusCard(
        context,
        icon: Icons.warning_amber_outlined,
        title: 'More authority work is needed',
        message: 'The latest review says the issue may still need attention.',
      );
    }
    return const SizedBox.shrink();
  }

  Widget _statusCard(
    BuildContext context, {
    required IconData icon,
    required String title,
    required String message,
    Widget? action,
  }) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: CwColors.mint.withValues(alpha: .55),
        borderRadius: BorderRadius.circular(18),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: CwColors.pine),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 4),
                Text(message),
                if (action != null) ...[
                  const SizedBox(height: 10),
                  action,
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final api = ref.read(apiClientProvider);
    final timing = [
      _timeAgo(incident.createdAt),
      if (widget.distanceLabel != null && widget.distanceLabel!.isNotEmpty)
        widget.distanceLabel!,
    ].join(' · ');
    return Scaffold(
      appBar: AppBar(title: const Text('Neighborhood report')),
      body: FutureBuilder<Map<String, dynamic>?>(
        future: _resolutionFuture,
        builder: (context, resolutionSnapshot) {
          final resolutionPayload = resolutionSnapshot.data;
          final resolutionIncident = resolutionPayload?['incident'];
          final status = resolutionIncident is Map &&
                  resolutionIncident['status'] != null
              ? resolutionIncident['status'].toString()
              : incident.status ?? 'verified';
          final evidence = (resolutionPayload?['evidence'] as List?)
                  ?.whereType<Map>()
                  .map((item) => ResolutionEvidenceItem.fromJson(
                      Map<String, dynamic>.from(item)))
                  .toList() ??
              const <ResolutionEvidenceItem>[];
          ResolutionEvidenceItem? authority;
          for (final item in evidence) {
            if (item.isAuthority) authority = item;
          }
          return Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 760),
              child: ListView(
                padding: const EdgeInsets.all(20),
                children: [
                  FutureBuilder<List<int>?>(
                    future: api.fetchPhotoBytes(incident.id),
                    builder: (context, snap) {
                      if (snap.connectionState == ConnectionState.waiting) {
                        return Container(
                          height: 180,
                          decoration: BoxDecoration(
                            color: CwColors.mint,
                            borderRadius: BorderRadius.circular(18),
                          ),
                          child: const Center(
                            child: CircularProgressIndicator(strokeWidth: 2),
                          ),
                        );
                      }
                      if (!ApiClient.hasRealPhoto(snap.data)) {
                        return Container(
                          height: 160,
                          decoration: BoxDecoration(
                            color: CwColors.mint.withValues(alpha: .5),
                            borderRadius: BorderRadius.circular(18),
                          ),
                          child: const Center(child: Text('Photo unavailable')),
                        );
                      }
                      return ClipRRect(
                        borderRadius: BorderRadius.circular(18),
                        child: Image.memory(
                          Uint8List.fromList(snap.data!),
                          height: 220,
                          fit: BoxFit.cover,
                          errorBuilder: (_, __, ___) => Container(
                            height: 160,
                            color: CwColors.mint,
                            child: const Icon(Icons.broken_image_outlined),
                          ),
                        ),
                      );
                    },
                  ),
                  const SizedBox(height: 16),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      _chip(
                        (incident.severity ?? 'medium').toUpperCase(),
                        severityColor(incident.severity),
                        Colors.white,
                      ),
                      _chip(_statusLabel(status), _statusColor(status),
                          Colors.white),
                      if (incident.category != null)
                        _chip(
                          environmentalCategoryLabel(incident.category!),
                          CwColors.mint,
                          CwColors.pine,
                        ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  Text(incident.title,
                      style: Theme.of(context).textTheme.headlineSmall),
                  if (timing.isNotEmpty) ...[
                    const SizedBox(height: 6),
                    Text(timing, style: Theme.of(context).textTheme.bodySmall),
                  ],
                  const SizedBox(height: 12),
                  Text(incident.description),
                  if (incident.aiReason != null &&
                      incident.aiReason!.isNotEmpty) ...[
                    const SizedBox(height: 16),
                    Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: CwColors.mint.withValues(alpha: .55),
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Icon(Icons.auto_awesome_outlined,
                              size: 18, color: CwColors.pine),
                          const SizedBox(width: 9),
                          Expanded(
                            child: Text(
                              'Why it was classified: ${incident.aiReason}',
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                  const SizedBox(height: 16),
                  Text(
                    incident.address != null && incident.address!.isNotEmpty
                        ? incident.address!
                        : '${incident.lat.toStringAsFixed(5)}, ${incident.lng.toStringAsFixed(5)}',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  if (incident.address != null && incident.address!.isNotEmpty)
                    Text(
                      '${incident.lat.toStringAsFixed(5)}, ${incident.lng.toStringAsFixed(5)}',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  const SizedBox(height: 18),
                  _resolutionCard(
                    context,
                    status: status,
                    authority: authority,
                    loading: resolutionSnapshot.connectionState ==
                        ConnectionState.waiting,
                    failed: resolutionSnapshot.hasError,
                  ),
                  const SizedBox(height: 18),
                  FilledButton.icon(
                    onPressed: _openInMaps,
                    icon: const Icon(Icons.map_outlined),
                    label: const Text('Open in Google Maps'),
                  ),
                  const SizedBox(height: 8),
                  OutlinedButton.icon(
                    onPressed: () {
                      Clipboard.setData(ClipboardData(
                        text:
                            'https://www.google.com/maps/search/?api=1&query=${incident.lat},${incident.lng}',
                      ));
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Location link copied.')),
                      );
                    },
                    icon: const Icon(Icons.link),
                    label: const Text('Copy link'),
                  ),
                ],
              ),
            ),
          );
        },
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
