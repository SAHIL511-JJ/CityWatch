import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:image_picker/image_picker.dart';
import 'package:uuid/uuid.dart';

import '../api_client.dart';
import '../outbox.dart';

const _maxPhotoBytes = 8 * 1024 * 1024;
const _allowedExts = ['jpg', 'jpeg', 'png'];
const _kDraftPrefix = 'draft_';

/// Guided 3-step report flow (KAN-23): Details → Photo → Location & review.
/// Inline errors, draft autosave, web-safe preview (bytes, never dart:io),
/// human error copy, offline fallback into the outbox (KAN-28).
class ReportScreen extends ConsumerStatefulWidget {
  const ReportScreen({super.key});

  @override
  ConsumerState<ReportScreen> createState() => _ReportScreenState();
}

class _ReportScreenState extends ConsumerState<ReportScreen> {

  final _title = TextEditingController();
  final _description = TextEditingController();
  final _address = TextEditingController();
  final _picker = ImagePicker();

  int _step = 0;
  Uint8List? _photoBytes;
  String _photoName = '';
  String? _photoError;
  String? _detailsError;
  String? _gpsError;
  double? _lat;
  double? _lng;
  double? _accuracy;
  bool _locating = false;
  bool _submitting = false;
  String? _sentId;
  String? _sentStatus;
  bool _draftLoaded = false;

  @override
  void initState() {
    super.initState();
    _title.addListener(_autosave);
    _description.addListener(_autosave);
    _address.addListener(_autosave);
    Future.microtask(_loadDraft);
  }

  @override
  void dispose() {
    _title.dispose();
    _description.dispose();
    _address.dispose();
    super.dispose();
  }

  Future<void> _loadDraft() async {
    final storage = ref.read(secureStorageProvider);
    _title.text = await storage.read(key: '${_kDraftPrefix}title') ?? '';
    _description.text =
        await storage.read(key: '${_kDraftPrefix}description') ?? '';
    _address.text =
        await storage.read(key: '${_kDraftPrefix}address') ?? '';
    final lat = await storage.read(key: '${_kDraftPrefix}lat');
    final lng = await storage.read(key: '${_kDraftPrefix}lng');
    if (!mounted) return;
    setState(() {
      _lat = lat == null ? null : double.tryParse(lat);
      _lng = lng == null ? null : double.tryParse(lng);
      _draftLoaded = true;
    });
  }

  Future<void> _autosave() async {
    if (!_draftLoaded) return;
    final storage = ref.read(secureStorageProvider);
    await storage.write(key: '${_kDraftPrefix}title', value: _title.text);
    await storage.write(
        key: '${_kDraftPrefix}description', value: _description.text);
    await storage.write(key: '${_kDraftPrefix}address', value: _address.text);
    if (_lat != null) {
      await storage.write(
          key: '${_kDraftPrefix}lat', value: _lat.toString());
      await storage.write(
          key: '${_kDraftPrefix}lng', value: _lng.toString());
    }
  }

  Future<void> _clearDraft() async {
    final storage = ref.read(secureStorageProvider);
    for (final k in ['title', 'description', 'address', 'lat', 'lng']) {
      await storage.delete(key: '$_kDraftPrefix$k');
    }
  }

  Future<void> _pickPhoto(ImageSource source) async {
    final file = await _picker.pickImage(
      source: source,
      maxWidth: 2048,
      imageQuality: 85,
    );
    if (file == null) return;
    final ext = file.path.split('.').last.toLowerCase();
    if (!_allowedExts.contains(ext)) {
      setState(
          () => _photoError = 'Only jpg or png photos work here.');
      return;
    }
    final bytes = await file.readAsBytes();
    if (bytes.lengthInBytes > _maxPhotoBytes) {
      setState(() => _photoError =
          'That photo is over 8MB — pick a smaller one.');
      return;
    }
    setState(() {
      _photoBytes = bytes;
      _photoName = file.name.isEmpty ? 'photo.$ext' : file.name;
      _photoError = null;
    });
  }

  Future<void> _useGps() async {
    setState(() {
      _locating = true;
      _gpsError = null;
    });
    try {
      var perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) {
        perm = await Geolocator.requestPermission();
      }
      if (perm == LocationPermission.denied ||
          perm == LocationPermission.deniedForever) {
        throw const _GpsDenied();
      }
      final pos = await Geolocator.getCurrentPosition(
        timeLimit: const Duration(seconds: 10),
      ).timeout(const Duration(seconds: 12));
      setState(() {
        _lat = pos.latitude;
        _lng = pos.longitude;
        _accuracy = pos.accuracy;
      });
      _autosave();
    } on _GpsDenied {
      setState(() => _gpsError =
          'Location permission is off — turn it on to tag your report.');
    } on TimeoutException {
      setState(() => _gpsError =
          'GPS timed out. Step outside or retry in a moment.');
    } catch (_) {
      setState(
          () => _gpsError = 'Could not read GPS. Retry in a moment.');
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  bool get _detailsOk =>
      _title.text.trim().isNotEmpty &&
      _description.text.trim().isNotEmpty;

  Future<void> _submit() async {
    setState(() => _submitting = true);
    final api = ref.read(apiClientProvider);
    final outbox = ref.read(outboxProvider.notifier);
    try {
      final res = await api.createIncidentBytes(
        title: _title.text.trim(),
        description: _description.text.trim(),
        lat: _lat!,
        lng: _lng!,
        address:
            _address.text.trim().isEmpty ? null : _address.text.trim(),
        photoBytes: _photoBytes!,
        filename: _photoName.isEmpty ? 'photo.jpg' : _photoName,
      );
      await _clearDraft();
      if (!mounted) return;
      setState(() {
        _sentId = res['id'] as String?;
        _sentStatus = (res['status'] as String?) ?? 'processing';
        _submitting = false;
      });
    } on DioException catch (e) {
      final offline = e.type == DioExceptionType.connectionError ||
          e.type == DioExceptionType.connectionTimeout ||
          e.type == DioExceptionType.unknown;
      if (offline && mounted) {
        await outbox.enqueue(OutboxItem(
          id: const Uuid().v4(),
          title: _title.text.trim(),
          description: _description.text.trim(),
          address: _address.text.trim().isEmpty
              ? null
              : _address.text.trim(),
          lat: _lat!,
          lng: _lng!,
          photoBase64: base64Encode(_photoBytes!),
          filename: _photoName.isEmpty ? 'photo.jpg' : _photoName,
          createdAt: DateTime.now().toIso8601String(),
        ));
        await _clearDraft();
        if (!mounted) return;
        setState(() => _submitting = false);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
                'Saved — no connection. It will send itself when you are back online. Track it under My reports.'),
            duration: Duration(seconds: 5),
          ),
        );
        _reset(keepDraft: false);
        return;
      }
      if (!mounted) return;
      setState(() => _submitting = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(OutboxNotifier.humanError(e))),
      );
    } catch (_) {
      if (!mounted) return;
      setState(() => _submitting = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('Could not send. Try again in a bit.')),
      );
    }
  }

  void _reset({bool keepDraft = false}) {
    if (!keepDraft) {
      _title.clear();
      _description.clear();
      _address.clear();
    }
    setState(() {
      _step = 0;
      _photoBytes = null;
      _photoName = '';
      _photoError = null;
      _detailsError = null;
      _gpsError = null;
      if (!keepDraft) {
        _lat = null;
        _lng = null;
        _accuracy = null;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_sentId != null) return _success();
    return Scaffold(
      appBar: AppBar(title: const Text('Report incident')),
      body: Stepper(
        currentStep: _step,
        onStepTapped: (i) => setState(() => _step = i),
        onStepContinue: _continue,
        onStepCancel:
            _step == 0 ? null : () => setState(() => _step -= 1),
        controlsBuilder: (context, details) => Padding(
          padding: const EdgeInsets.only(top: 12),
          child: Row(
            children: [
              FilledButton(
                onPressed: _submitting ? null : details.onStepContinue,
                child: Text(_step == 2
                    ? (_submitting ? 'Sending…' : 'Send report')
                    : 'Continue'),
              ),
              const SizedBox(width: 8),
              if (_step > 0)
                TextButton(
                  onPressed:
                      _submitting ? null : details.onStepCancel,
                  child: const Text('Back'),
                ),
            ],
          ),
        ),
        steps: [
          Step(
            title: const Text('Details'),
            subtitle: const Text('What happened'),
            isActive: _step >= 0,
            state: _step > 0 ? StepState.complete : StepState.indexed,
            content: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextField(
                  controller: _title,
                  maxLength: 120,
                  decoration: const InputDecoration(
                    labelText: 'Title *',
                    hintText: 'e.g. Pothole flooding the lane',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: _description,
                  maxLines: 4,
                  maxLength: 500,
                  decoration: const InputDecoration(
                    labelText: 'Description *',
                    hintText: 'What, where, how bad — 1-2 lines',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: _address,
                  decoration: const InputDecoration(
                    labelText: 'Address (optional)',
                    border: OutlineInputBorder(),
                  ),
                ),
                if (_detailsError != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(_detailsError!,
                        style: TextStyle(
                            color:
                                Theme.of(context).colorScheme.error)),
                  ),
              ],
            ),
          ),
          Step(
            title: const Text('Photo'),
            subtitle: const Text('Required, jpg/png under 8MB'),
            isActive: _step >= 1,
            state: _step > 1 ? StepState.complete : StepState.indexed,
            content: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: kIsWeb
                            ? null
                            : () => _pickPhoto(ImageSource.camera),
                        icon: const Icon(Icons.camera_alt_outlined),
                        label: const Text('Camera'),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: () =>
                            _pickPhoto(ImageSource.gallery),
                        icon: const Icon(Icons.photo_outlined),
                        label: const Text('Gallery'),
                      ),
                    ),
                  ],
                ),
                if (_photoBytes != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        ClipRRect(
                          borderRadius: BorderRadius.circular(8),
                          child: Image.memory(_photoBytes!,
                              height: 180,
                              width: double.infinity,
                              fit: BoxFit.cover),
                        ),
                        Row(
                          children: [
                            Expanded(child: Text(_photoName)),
                            TextButton(
                              onPressed: () => setState(() {
                                _photoBytes = null;
                                _photoName = '';
                              }),
                              child: const Text('Remove'),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                if (_photoError != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(_photoError!,
                        style: TextStyle(
                            color:
                                Theme.of(context).colorScheme.error)),
                  ),
              ],
            ),
          ),
          Step(
            title: const Text('Location & review'),
            subtitle: const Text('GPS, then send'),
            isActive: _step >= 2,
            content: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                OutlinedButton.icon(
                  onPressed: _locating ? null : _useGps,
                  icon: _locating
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child:
                              CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.my_location),
                  label: Text(_lat == null
                      ? 'Use GPS *'
                      : 'GPS: ${_lat!.toStringAsFixed(5)}, ${_lng!.toStringAsFixed(5)}${_accuracy != null && _accuracy! > 0 ? ' (±${_accuracy!.toStringAsFixed(0)}m)' : ''}'),
                ),
                if (_gpsError != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(_gpsError!,
                        style: TextStyle(
                            color:
                                Theme.of(context).colorScheme.error)),
                  ),
                const SizedBox(height: 12),
                _reviewRow('Title', _title.text.trim()),
                _reviewRow('Details', _description.text.trim()),
                _reviewRow('Photo', _photoBytes == null
                    ? 'Missing — go back one step'
                    : _photoName),
                _reviewRow('Spot', _lat == null
                    ? 'Missing — tap Use GPS'
                    : '${_lat!.toStringAsFixed(5)}, ${_lng!.toStringAsFixed(5)}'),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _reviewRow(String k, String v) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
              width: 64,
              child: Text(k,
                  style: Theme.of(context).textTheme.bodySmall)),
          Expanded(child: Text(v)),
        ],
      ),
    );
  }

  void _continue() {
    if (_step == 0) {
      if (!_detailsOk) {
        setState(() => _detailsError =
            'Add a short title and a line of detail first.');
        return;
      }
      setState(() {
        _detailsError = null;
        _step = 1;
      });
    } else if (_step == 1) {
      if (_photoBytes == null) {
        setState(() => _photoError = 'A photo is required to send.');
        return;
      }
      setState(() => _step = 2);
    } else {
      if (_lat == null || _lng == null) {
        setState(() =>
            _gpsError = 'Tap Use GPS so crews can find the spot.');
        return;
      }
      _submit();
    }
  }

  Widget _success() {
    return Scaffold(
      appBar: AppBar(title: const Text('Report incident')),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.check_circle_outline,
                  size: 64, color: Colors.green.shade700),
              const SizedBox(height: 12),
              const Text('Report sent!',
                  style: TextStyle(
                      fontSize: 20, fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              Text(
                'AI triage is checking it now (status: ${_sentStatus ?? 'processing'}). It appears in the feed once verified.',
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: () {
                  setState(() {
                    _sentId = null;
                    _sentStatus = null;
                  });
                  _reset();
                },
                child: const Text('File another report'),
              ),
              TextButton(
                onPressed: () {
                  setState(() {
                    _sentId = null;
                    _sentStatus = null;
                  });
                  _reset();
                },
                child: const Text('Back to form'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _GpsDenied implements Exception {
  const _GpsDenied();
}
