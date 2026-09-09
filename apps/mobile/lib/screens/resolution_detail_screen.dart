import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../api_client.dart';
import '../auth_provider.dart';
import '../cw_theme.dart';
import 'verify_screen.dart';

class ResolutionDetailScreen extends ConsumerStatefulWidget {
  const ResolutionDetailScreen({super.key, required this.incidentId});

  final String incidentId;

  @override
  ConsumerState<ResolutionDetailScreen> createState() =>
      _ResolutionDetailScreenState();
}

class _ResolutionDetailScreenState
    extends ConsumerState<ResolutionDetailScreen> {
  late Future<Map<String, dynamic>> _future;
  final _observation = TextEditingController();
  XFile? _selectedPhoto;
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    _future = ref.read(apiClientProvider).fetchMyIncident(widget.incidentId);
  }

  @override
  void dispose() {
    _observation.dispose();
    super.dispose();
  }

  void _reload() {
    setState(() {
      _future = ref.read(apiClientProvider).fetchMyIncident(widget.incidentId);
    });
  }

  String _label(String value) => value.replaceAll('_', ' ');

  Future<void> _pickPhoto(ImageSource source) async {
    final picked = await ImagePicker().pickImage(source: source);
    if (picked != null && mounted) setState(() => _selectedPhoto = picked);
  }

  Future<void> _submitFollowUp() async {
    final auth = ref.read(authProvider);
    if (!auth.verified) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content:
                Text('Verify your account before submitting a follow-up.')),
      );
      return;
    }
    if (_observation.text.trim().isEmpty || _selectedPhoto == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Add an observation and a photo first.')),
      );
      return;
    }
    setState(() => _submitting = true);
    try {
      await ref.read(apiClientProvider).submitResolutionFollowUp(
            incidentId: widget.incidentId,
            observation: _observation.text.trim(),
            photo: _selectedPhoto!,
          );
      _observation.clear();
      setState(() => _selectedPhoto = null);
      _reload();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
              content: Text('Follow-up submitted for authority review.')),
        );
      }
    } on DioException catch (error) {
      final code = error.response?.statusCode;
      final message = code == 403
          ? 'Verify your account before submitting a follow-up.'
          : code == 409
              ? 'A follow-up is already waiting for this resolution.'
              : 'Could not submit the follow-up. Please try again.';
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(message)));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
              content:
                  Text('Could not submit the follow-up. Please try again.')),
        );
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Widget _evidencePhoto(BuildContext context, ResolutionEvidenceItem evidence) {
    if (!evidence.hasPhoto) {
      return const SizedBox.shrink();
    }
    final api = ref.read(apiClientProvider);
    return FutureBuilder<List<int>?>(
      future: api.fetchResolutionEvidencePhoto(evidence.id),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return Container(
            height: 150,
            margin: const EdgeInsets.only(top: 10),
            decoration: BoxDecoration(
              color: CwColors.mint,
              borderRadius: BorderRadius.circular(14),
            ),
            child:
                const Center(child: CircularProgressIndicator(strokeWidth: 2)),
          );
        }
        final bytes = snapshot.data;
        if (bytes == null || bytes.isEmpty) return const SizedBox.shrink();
        return ClipRRect(
          borderRadius: BorderRadius.circular(14),
          child: Image.memory(
            Uint8List.fromList(bytes),
            height: 180,
            width: double.infinity,
            fit: BoxFit.cover,
            errorBuilder: (_, __, ___) => const SizedBox.shrink(),
          ),
        );
      },
    );
  }

  Widget _evidenceCard(BuildContext context, ResolutionEvidenceItem item) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: item.isAuthority
            ? CwColors.mint.withValues(alpha: .5)
            : const Color(0xFFFFF7E6),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: CwColors.sand),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                  item.isAuthority
                      ? Icons.build_outlined
                      : Icons.groups_outlined,
                  size: 18,
                  color: CwColors.pine),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  item.isAuthority ? 'Authority action' : 'Community follow-up',
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
              ),
              Text(_label(item.reviewOutcome),
                  style: Theme.of(context).textTheme.bodySmall),
            ],
          ),
          const SizedBox(height: 8),
          Text(item.note),
          if (item.reviewNote != null && item.reviewNote!.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text('Review: ${item.reviewNote}',
                style: Theme.of(context).textTheme.bodySmall),
          ],
          _evidencePhoto(context, item),
          if (item.createdAt != null) ...[
            const SizedBox(height: 8),
            Text(item.createdAt!.substring(0, 10),
                style: Theme.of(context).textTheme.bodySmall),
          ],
        ],
      ),
    );
  }

  Widget _followUpForm(
    BuildContext context, {
    required bool awaiting,
    required bool canSubmit,
    required bool hasPending,
  }) {
    if (!awaiting) return const SizedBox.shrink();
    final verified = ref.watch(authProvider).verified;
    if (!verified) {
      return Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: CwColors.paper,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: CwColors.sand),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Verify your account to submit follow-up evidence',
                style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 6),
            const Text(
                'You can read this resolution timeline now. Verification is required before sharing a current observation.'),
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const VerifyScreen()),
              ),
              child: const Text('Verify account'),
            ),
          ],
        ),
      );
    }
    if (!canSubmit) {
      return hasPending
          ? const Padding(
              padding: EdgeInsets.symmetric(vertical: 8),
              child: Text('Your follow-up is waiting for staff review.'),
            )
          : const SizedBox.shrink();
    }
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: CwColors.paper,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: CwColors.sand),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Is the issue still present?',
              style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 6),
          Text(
              'Stay safe—do not approach a dangerous condition. Share what you can see from a safe distance so the authority can confirm the repair.',
              style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: 12),
          TextField(
            controller: _observation,
            maxLength: 2000,
            maxLines: 3,
            decoration: const InputDecoration(
                hintText: 'Describe the current condition…'),
          ),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed:
                      _submitting ? null : () => _pickPhoto(ImageSource.camera),
                  icon: const Icon(Icons.camera_alt_outlined),
                  label: const Text('Camera'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _submitting
                      ? null
                      : () => _pickPhoto(ImageSource.gallery),
                  icon: const Icon(Icons.photo_library_outlined),
                  label: const Text('Gallery'),
                ),
              ),
            ],
          ),
          if (_selectedPhoto != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text('Photo selected: ${_selectedPhoto!.name}'),
            ),
          const SizedBox(height: 8),
          FilledButton(
            onPressed: _submitting || !verified ? null : _submitFollowUp,
            child: Text(_submitting ? 'Submitting…' : 'Submit follow-up'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Report progress')),
      body: FutureBuilder<Map<String, dynamic>>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError || snapshot.data == null) {
            return const Center(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Text(
                  'This report is not available on this account.',
                  textAlign: TextAlign.center,
                ),
              ),
            );
          }
          final raw = snapshot.data!;
          final incidentJson =
              Map<String, dynamic>.from((raw['incident'] as Map?) ?? raw);
          final incident = IncidentItem.fromJson(incidentJson);
          final evidence = ((raw['evidence'] as List?) ?? const [])
              .whereType<Map>()
              .map((item) => ResolutionEvidenceItem.fromJson(
                  Map<String, dynamic>.from(item)))
              .toList();
          final resolution = raw['resolution'] is Map
              ? Map<String, dynamic>.from(raw['resolution'] as Map)
              : null;
          final awaiting = incident.status == 'awaiting_verification';
          final canSubmit = resolution?['can_submit_follow_up'] == true;
          final hasPending = evidence.any((item) =>
              item.evidenceType == 'community_follow_up' &&
              item.reviewOutcome == 'pending');
          return RefreshIndicator(
            onRefresh: () async => _reload(),
            child: ListView(
              padding: const EdgeInsets.all(20),
              children: [
                Text(incident.title,
                    style: Theme.of(context).textTheme.headlineSmall),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  children: [
                    Chip(label: Text(_label(incident.status ?? 'processing'))),
                    if (incident.severity != null)
                      Chip(label: Text(incident.severity!)),
                  ],
                ),
                const SizedBox(height: 8),
                Text(incident.description),
                const SizedBox(height: 20),
                Text('Resolution timeline',
                    style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 10),
                if (evidence.isEmpty)
                  const Text('No resolution evidence has been recorded yet.')
                else
                  ...evidence.map((item) => Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: _evidenceCard(context, item),
                      )),
                _followUpForm(
                  context,
                  awaiting: awaiting,
                  canSubmit: canSubmit,
                  hasPending: hasPending,
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}
