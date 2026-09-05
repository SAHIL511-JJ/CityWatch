import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:image_picker/image_picker.dart';

import '../api_client.dart';

const _maxPhotoBytes = 8 * 1024 * 1024;
const _allowedExts = ['jpg', 'jpeg', 'png'];

class ReportScreen extends ConsumerStatefulWidget {
  const ReportScreen({super.key});

  @override
  ConsumerState<ReportScreen> createState() => _ReportScreenState();
}

class _ReportScreenState extends ConsumerState<ReportScreen> {
  final _formKey = GlobalKey<FormState>();
  final _title = TextEditingController();
  final _description = TextEditingController();
  final _address = TextEditingController();
  final _picker = ImagePicker();

  XFile? _photo;
  String? _photoError;
  double? _lat;
  double? _lng;
  bool _locating = false;
  bool _submitting = false;
  String? _result;

  @override
  void dispose() {
    _title.dispose();
    _description.dispose();
    _address.dispose();
    super.dispose();
  }

  Future<void> _pickPhoto(ImageSource source) async {
    final file = await _picker.pickImage(
      source: source,
      maxWidth: 2048,
      imageQuality: 85,
    );
    if (file == null) return;
    final err = await _checkPhoto(file);
    setState(() {
      _photo = err == null ? file : null;
      _photoError = err;
    });
  }

  Future<String?> _checkPhoto(XFile file) async {
    final ext = file.path.split('.').last.toLowerCase();
    if (!_allowedExts.contains(ext)) {
      return 'Only jpg/png photos allowed.';
    }
    final bytes = await file.length();
    if (bytes > _maxPhotoBytes) {
      return 'Photo too big — pick one under 8MB.';
    }
    return null;
  }

  Future<void> _useGps() async {
    setState(() => _locating = true);
    try {
      var perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) {
        perm = await Geolocator.requestPermission();
      }
      if (perm == LocationPermission.denied ||
          perm == LocationPermission.deniedForever) {
        throw StateError('Location permission denied');
      }
      final pos = await Geolocator.getCurrentPosition();
      setState(() {
        _lat = pos.latitude;
        _lng = pos.longitude;
      });
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('GPS failed: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    if (_photo == null) {
      setState(() => _photoError ??= 'Photo needed — add one to submit.');
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Photo needed — add one to submit.')),
      );
      return;
    }
    if (_lat == null || _lng == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Tap "Use GPS" first.')),
      );
      return;
    }
    setState(() {
      _submitting = true;
      _result = null;
    });
    try {
      final json = await ref.read(apiClientProvider).createIncident(
            title: _title.text.trim(),
            description: _description.text.trim(),
            lat: _lat!,
            lng: _lng!,
            address:
                _address.text.trim().isEmpty ? null : _address.text.trim(),
            photo: _photo,
          );
      setState(() {
        _result =
            'Sent! AI checking... ${json['id'] ?? ''} (status: ${json['status'] ?? 'processing'})';
      });
      _title.clear();
      _description.clear();
      _address.clear();
      setState(() => _photo = null);
    } catch (e) {
      setState(() => _result = 'Submit failed: $e');
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final canSubmit = !_submitting && _photo != null && _lat != null;
    return Scaffold(
      appBar: AppBar(title: const Text('Report incident')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextFormField(
                controller: _title,
                decoration: const InputDecoration(
                  labelText: 'Title *',
                  border: OutlineInputBorder(),
                ),
                validator: (v) =>
                    (v == null || v.trim().isEmpty) ? 'Required' : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _description,
                maxLines: 4,
                decoration: const InputDecoration(
                  labelText: 'Description *',
                  border: OutlineInputBorder(),
                ),
                validator: (v) =>
                    (v == null || v.trim().isEmpty) ? 'Required' : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _address,
                decoration: const InputDecoration(
                  labelText: 'Address (optional)',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              const Text('Photo * — no photo = no submit'),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () => _pickPhoto(ImageSource.camera),
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
              if (_photo != null)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      ClipRRect(
                        borderRadius: BorderRadius.circular(8),
                        child: Image.file(
                          File(_photo!.path),
                          height: 180,
                          width: double.infinity,
                          fit: BoxFit.cover,
                        ),
                      ),
                      Row(
                        children: [
                          Expanded(child: Text('Photo: ${_photo!.name}')),
                          TextButton(
                            onPressed: () => setState(() => _photo = null),
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
                  child: Text(
                    _photoError!,
                    style: TextStyle(
                        color: Theme.of(context).colorScheme.error),
                  ),
                ),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: _locating ? null : _useGps,
                icon: _locating
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.my_location),
                label: Text(
                  _lat == null
                      ? 'Use GPS *'
                      : 'GPS: ${_lat!.toStringAsFixed(5)}, ${_lng!.toStringAsFixed(5)}',
                ),
              ),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: canSubmit ? _submit : null,
                icon: const Icon(Icons.send_outlined),
                label: Text(_submitting ? 'Submitting…' : 'Submit report'),
              ),
              if (!canSubmit && !_submitting)
                const Padding(
                  padding: EdgeInsets.only(top: 8),
                  child: Text(
                    'Add a photo and GPS to enable submit.',
                    style: TextStyle(fontSize: 12, color: Colors.grey),
                  ),
                ),
              if (_result != null)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Text(_result!),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
