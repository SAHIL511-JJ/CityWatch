import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api_client.dart';
import '../outbox.dart';

/// My reports (KAN-28): everything this device sent or queued,
/// each with a live status. Auto-retries pending items on open.
class MyReportsScreen extends ConsumerStatefulWidget {
  const MyReportsScreen({super.key});

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
          final j = await api.fetchIncident(item.remoteId!);
          _liveStatus[item.id] = (j['status'] as String?) ?? 'processing';
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
              'Everything you have sent or saved offline',
              style: TextStyle(
                color: Color(0xFFB9C9BD),
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
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(28),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
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
                        Text('Your report trail is empty',
                            style: Theme.of(context).textTheme.titleLarge),
                        const SizedBox(height: 8),
                        Text(
                          'Reports you send — even offline — will appear here with their live status.',
                          textAlign: TextAlign.center,
                          style: Theme.of(context).textTheme.bodyMedium,
                        ),
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
                    padding: const EdgeInsets.all(12),
                    itemCount: items.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 8),
                    itemBuilder: (context, i) {
                      final e = items[i];
                      final status = e.state == 'sent'
                          ? (_liveStatus[e.id] ?? 'processing')
                          : e.state;
                      return Card(
                        child: ListTile(
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
