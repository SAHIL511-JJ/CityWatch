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
import '../cw_theme.dart';
import '../outbox.dart';

const _maxPhotoBytes = 8 * 1024 * 1024;
const _allowedExts = ['jpg', 'jpeg', 'png'];
const _kDraftPrefix = 'draft_';

/// Guided 3-step environmental observation flow (KAN-23): Details → Photo → Location & review.
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
    _address.text = await storage.read(key: '${_kDraftPrefix}address') ?? '';
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
      await storage.write(key: '${_kDraftPrefix}lat', value: _lat.toString());
      await storage.write(key: '${_kDraftPrefix}lng', value: _lng.toString());
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
      setState(() => _photoError = 'Only jpg or png photos work here.');
      return;
    }
    final bytes = await file.readAsBytes();
    if (bytes.lengthInBytes > _maxPhotoBytes) {
      setState(
          () => _photoError = 'That photo is over 8MB — pick a smaller one.');
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
      setState(() =>
          _gpsError = 'GPS timed out. Step outside or retry in a moment.');
    } catch (_) {
      setState(() => _gpsError = 'Could not read GPS. Retry in a moment.');
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  bool get _detailsOk =>
      _title.text.trim().isNotEmpty && _description.text.trim().isNotEmpty;

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
        address: _address.text.trim().isEmpty ? null : _address.text.trim(),
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
          address: _address.text.trim().isEmpty ? null : _address.text.trim(),
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
        const SnackBar(content: Text('Could not send. Try again in a bit.')),
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
    const titles = [
      'Tell us what happened.',
      'A photo tells the story.',
      'Put it on the map.'
    ];
    const descriptions = [
      'Start with the essentials. A clear report helps your neighborhood respond.',
      'Add a clear photo of the environmental condition. Only take a photo when it’s safe.',
      'Confirm the location and check your details before sending.',
    ];
    final contents = <Widget>[
      Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            controller: _title,
            maxLength: 120,
            decoration: const InputDecoration(
              labelText: 'What happened? *',
              hintText: 'e.g. Broken streetlight on Park Road',
            ),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _description,
            maxLines: 4,
            maxLength: 500,
            decoration: const InputDecoration(
              labelText: 'Add a few details *',
              hintText: 'What did you notice? How does it affect the area?',
            ),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _address,
            decoration: const InputDecoration(
              labelText: 'Landmark or address (optional)',
              prefixIcon: Icon(Icons.location_on_outlined),
            ),
          ),
          if (_detailsError != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(_detailsError!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ),
        ],
      ),
      Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_photoBytes == null) ...[
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 36),
              decoration: BoxDecoration(
                  color: CwColors.mint.withValues(alpha: .5),
                  borderRadius: BorderRadius.circular(24)),
              child: Column(children: [
                Container(
                    padding: const EdgeInsets.all(18),
                    decoration: const BoxDecoration(
                        color: CwColors.paper, shape: BoxShape.circle),
                    child: const Icon(Icons.add_a_photo_outlined,
                        size: 34, color: CwColors.pine)),
                const SizedBox(height: 20),
                Text('Show what you see',
                    style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 8),
                const Text('JPG or PNG · Up to 8 MB',
                    style: TextStyle(color: CwColors.muted, fontSize: 12)),
              ]),
            ),
            const SizedBox(height: 18),
          ],
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed:
                      kIsWeb ? null : () => _pickPhoto(ImageSource.camera),
                  icon: const Icon(Icons.camera_alt_outlined),
                  label: const Text('Camera'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () => _pickPhoto(ImageSource.gallery),
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
                    borderRadius: BorderRadius.circular(22),
                    child: Image.memory(_photoBytes!,
                        height: 230, width: double.infinity, fit: BoxFit.cover),
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
                  style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ),
        ],
      ),
      Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          OutlinedButton.icon(
            onPressed: _locating ? null : _useGps,
            icon: _locating
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
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
                  style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ),
          const SizedBox(height: 12),
          _reviewRow('Title', _title.text.trim()),
          _reviewRow('Details', _description.text.trim()),
          _reviewRow('Photo',
              _photoBytes == null ? 'Missing — go back one step' : _photoName),
          _reviewRow(
              'Spot',
              _lat == null
                  ? 'Missing — tap Use GPS'
                  : '${_lat!.toStringAsFixed(5)}, ${_lng!.toStringAsFixed(5)}'),
        ],
      )
    ];
    return Scaffold(
      appBar: AppBar(
        title: const Text('New report'),
        actions: const [
          Padding(
              padding: EdgeInsets.only(right: 22),
              child: Row(children: [
                Icon(Icons.edit_note_rounded, size: 18, color: CwColors.muted),
                SizedBox(width: 5),
                Text('Draft',
                    style: TextStyle(fontSize: 12, color: CwColors.muted)),
              ]))
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(22, 12, 22, 28),
        children: [
          Row(
              children: List.generate(
                  3,
                  (i) => Expanded(
                        child: Padding(
                          padding: EdgeInsets.only(right: i < 2 ? 10 : 0),
                          child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                AnimatedContainer(
                                  duration: const Duration(milliseconds: 220),
                                  height: 4,
                                  decoration: BoxDecoration(
                                      color: i <= _step
                                          ? CwColors.pine
                                          : CwColors.sand,
                                      borderRadius: BorderRadius.circular(4)),
                                ),
                                const SizedBox(height: 10),
                                Text(
                                    [
                                      '01  Details',
                                      '02  Photo',
                                      '03  Review'
                                    ][i],
                                    style: TextStyle(
                                        fontSize: 11,
                                        fontWeight: FontWeight.w700,
                                        color: i <= _step
                                            ? CwColors.pine
                                            : CwColors.muted)),
                              ]),
                        ),
                      ))),
          const SizedBox(height: 30),
          CwPageIntro(
              eyebrow: 'Step ${_step + 1} of 3',
              title: titles[_step],
              description: descriptions[_step]),
          const SizedBox(height: 26),
          AnimatedSize(
            duration: MediaQuery.disableAnimationsOf(context)
                ? Duration.zero
                : const Duration(milliseconds: 220),
            alignment: Alignment.topCenter,
            child: contents[_step],
          ),
          const SizedBox(height: 24),
          FilledButton(
            onPressed: _submitting ? null : _continue,
            child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              if (_submitting) ...[
                const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2)),
                const SizedBox(width: 10),
              ],
              Text(_step == 2
                  ? (_submitting ? 'Sending report…' : 'Send report')
                  : 'Continue'),
              if (!_submitting) ...[
                const SizedBox(width: 10),
                const Icon(Icons.arrow_forward_rounded, size: 18)
              ],
            ]),
          ),
          if (_step > 0) ...[
            const SizedBox(height: 8),
            TextButton(
                onPressed:
                    _submitting ? null : () => setState(() => _step -= 1),
                child: const Text('Back to previous step')),
          ],
          const SizedBox(height: 20),
          const Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Icon(Icons.lock_outline_rounded, size: 16, color: CwColors.muted),
            SizedBox(width: 8),
            Expanded(
                child: Text(
                    'Your report is reviewed before it appears in the community feed.',
                    style: TextStyle(
                        fontSize: 12, color: CwColors.muted, height: 1.5))),
          ]),
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
              child: Text(k, style: Theme.of(context).textTheme.bodySmall)),
          Expanded(child: Text(v)),
        ],
      ),
    );
  }

  void _continue() {
    if (_step == 0) {
      if (!_detailsOk) {
        setState(() =>
            _detailsError = 'Add a short title and a line of detail first.');
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
        setState(() => _gpsError = 'Tap Use GPS so crews can find the spot.');
        return;
      }
      _submit();
    }
  }

  Widget _success() {
    return Scaffold(
        appBar: AppBar(title: const Text('Report observation')),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.check_circle_outline,
                  size: 64, color: Colors.green.shade700),
              const SizedBox(height: 12),
              const NeighborhoodArt(),
              const Text('Thanks for looking out.',
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              Text(
                'Your report is ${_sentStatus ?? 'processing'}. Once verified, it will appear in the neighborhood feed.',
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
