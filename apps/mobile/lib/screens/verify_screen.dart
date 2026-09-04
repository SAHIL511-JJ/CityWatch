import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth_provider.dart';

class VerifyScreen extends ConsumerStatefulWidget {
  const VerifyScreen({super.key});

  @override
  ConsumerState<VerifyScreen> createState() => _VerifyScreenState();
}

class _VerifyScreenState extends ConsumerState<VerifyScreen> {
  final _contact = TextEditingController();
  final _code = TextEditingController();
  bool _isEmail = false;
  bool _codeSent = false;
  bool _busy = false;

  @override
  void dispose() {
    _contact.dispose();
    _code.dispose();
    super.dispose();
  }

  String? _phone() => _isEmail ? null : _contact.text.trim();
  String? _email() => _isEmail ? _contact.text.trim() : null;

  Future<void> _send() async {
    if (_contact.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enter phone or email first.')),
      );
      return;
    }
    setState(() => _busy = true);
    try {
      await ref
          .read(authProvider.notifier)
          .sendCode(phone: _phone(), email: _email());
      setState(() => _codeSent = true);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Code sent (valid 10 min).')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Send failed: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _verify() async {
    if (_code.text.trim().isEmpty) return;
    setState(() => _busy = true);
    try {
      await ref.read(authProvider.notifier).verifyCode(
            phone: _phone(),
            email: _email(),
            code: _code.text.trim(),
          );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Verified ✓')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Verify failed: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Verify identity')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SegmentedButton<bool>(
              segments: const [
                ButtonSegment(value: false, label: Text('Phone')),
                ButtonSegment(value: true, label: Text('Email')),
              ],
              selected: {_isEmail},
              onSelectionChanged: (s) => setState(() => _isEmail = s.first),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _contact,
              keyboardType:
                  _isEmail ? TextInputType.emailAddress : TextInputType.phone,
              decoration: InputDecoration(
                labelText: _isEmail ? 'Email' : 'Phone',
                border: const OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed: _busy ? null : _send,
              child: Text(_codeSent ? 'Resend code' : 'Send code'),
            ),
            if (_codeSent) ...[
              const SizedBox(height: 12),
              TextField(
                controller: _code,
                keyboardType: TextInputType.number,
                maxLength: 6,
                decoration: const InputDecoration(
                  labelText: '6-digit code',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 8),
              FilledButton(
                onPressed: _busy ? null : _verify,
                child: const Text('Verify'),
              ),
            ],
            const SizedBox(height: 16),
            Text(
              'Status: ${auth.verified ? 'verified ✓ (trust 0.8)' : 'anonymous (trust 0.5)'}\n'
              'User: ${auth.userId ?? '—'}',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            if (auth.error != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  auth.error!,
                  style: TextStyle(
                    color: Theme.of(context).colorScheme.error,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
