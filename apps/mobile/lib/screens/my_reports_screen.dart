import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api_client.dart';
import '../cw_theme.dart';
import '../outbox.dart';
import 'resolution_detail_screen.dart';

/// My reports (KAN-28): everything this device sent or queued,
/// each with a live status. Auto-retries pending items on open.
class MyReportsScreen extends ConsumerStatefulWidget {
  const MyReportsScreen({super.key, this.onReport});
  final VoidCallback? onReport;

  @override
  ConsumerState<MyReportsScreen> createState() => _MyReportsScreenState();
}

class _MyReportsScreenState extends ConsumerState<MyReportsScreen> {
  final Map<String, String> _liveStatus = {};
  bool _checking = false;

  @override
  void initState() {
    super.initState();
    Future.microtask(() async {
      await ref.read(outboxProvider.notifier).retryAll();
      _refreshStatuses();
    });
  }

  Future<void> _refreshStatuses() async {
    setState(() => _checking = true);
    try {
      final api = ref.read(apiClientProvider);
      final items = ref.read(outboxProvider).where((e) => e.remoteId != null);
      for (final item in items) {
        try {
          final j = await api.fetchMyIncident(item.remoteId!);
          final incident = j['incident'] as Map?;
          _liveStatus[item.id] =
              (incident?['status'] as String?) ?? 'processing';
        } catch (_) {
          // Keep last known state; never leak exceptions.
        }
      }
    } finally {
      if (mounted) setState(() => _checking = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final items = ref.watch(outboxProvider);
    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: false,
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('My reports'),
            Text(
              'Your device’s saved report queue',
              style: TextStyle(
                color: CwColors.muted,
                fontSize: 11,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'Retry pending',
            icon: const Icon(Icons.sync),
            onPressed: () async {
              await ref.read(outboxProvider.notifier).retryAll();
              _refreshStatuses();
            },
          ),
        ],
      ),
      body: _checking && items.isEmpty
          ? const Center(child: CircularProgressIndicator())
          : items.isEmpty
              ? SingleChildScrollView(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(24, 20, 24, 32),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const CwPageIntro(
                            eyebrow: 'Small actions matter',
                            title: 'Your city.\nYour contribution.',
                            description:
                                'Keep track of reports saved on this device, from queued to reviewed.'),
                        const SizedBox(height: 28),
                        const NeighborhoodArt(height: 180),
                        const SizedBox(height: 26),
                        Container(
                          width: 72,
                          height: 72,
                          decoration: BoxDecoration(
                            color: const Color(0xFFD8E9D8),
                            borderRadius: BorderRadius.circular(22),
                          ),
                          child: const Icon(Icons.history_rounded,
                              size: 34, color: Color(0xFF2E5B45)),
                        ),
                        const SizedBox(height: 18),
                        Text('Every report starts with you',
                            textAlign: TextAlign.center,
                            style: Theme.of(context).textTheme.titleLarge),
                        const SizedBox(height: 8),
                        Text(
                          'No reports in your device’s queue yet. When a report is saved offline, you can follow its progress here.',
                          textAlign: TextAlign.center,
                          style: Theme.of(context).textTheme.bodyMedium,
                        ),
                        const SizedBox(height: 24),
                        FilledButton.icon(
                            onPressed: widget.onReport,
                            icon: const Icon(Icons.add_rounded),
                            label: const Text('Create a report')),
                      ],
                    ),
                  ),
                )
              : RefreshIndicator(
                  onRefresh: () async {
                    await ref.read(outboxProvider.notifier).retryAll();
                    _refreshStatuses();
                  },
                  child: ListView.separated(
                    padding: const EdgeInsets.all(20),
                    itemCount: items.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 14),
                    itemBuilder: (context, i) {
                      final e = items[i];
                      final status = e.state == 'sent'
                          ? (_liveStatus[e.id] ?? 'processing')
                          : e.state;
                      return Card(
                        child: ListTile(
                          onTap: e.state == 'sent' && e.remoteId != null
                              ? () => Navigator.of(context).push(
                                    MaterialPageRoute(
                                      builder: (_) => ResolutionDetailScreen(
                                        incidentId: e.remoteId!,
                                      ),
                                    ),
                                  )
                              : null,
                          contentPadding: const EdgeInsets.symmetric(
                              horizontal: 16, vertical: 8),
                          leading: Icon(
                            e.state == 'sent'
                                ? Icons.check_circle_outline
                                : e.state == 'sending'
                                    ? Icons.sync
                                    : Icons.schedule,
                            color: e.state == 'failed'
                                ? Colors.red.shade700
                                : Colors.green.shade700,
                          ),
                          title: Text(e.title),
                          subtitle: Text(
                            e.state == 'sent'
                                ? 'Status: $status'
                                : e.state == 'failed'
                                    ? (e.error ?? 'Could not send. Will retry.')
                                    : 'Waiting to send…',
                          ),
                          trailing: e.state == 'failed'
                              ? Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    IconButton(
                                      tooltip: 'Retry now',
                                      icon: const Icon(Icons.refresh),
                                      onPressed: () => ref
                                          .read(outboxProvider.notifier)
                                          .sendOne(e),
                                    ),
                                    IconButton(
                                      tooltip: 'Discard',
                                      icon: const Icon(Icons.delete_outline),
                                      onPressed: () => ref
                                          .read(outboxProvider.notifier)
                                          .remove(e.id),
                                    ),
                                  ],
                                )
                              : e.state == 'sent'
                                  ? null
                                  : const SizedBox(
                                      width: 20,
                                      height: 20,
                                      child: CircularProgressIndicator(
                                          strokeWidth: 2),
                                    ),
                        ),
                      );
                    },
                  ),
                ),
    );
  }
}
