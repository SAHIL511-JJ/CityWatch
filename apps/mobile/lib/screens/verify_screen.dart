import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth_provider.dart';

/// Verify identity, premium pass (KAN-30): platform autofill hints,
/// 30s resend countdown, inline field errors, input preserved across
/// Phone/Email switch, human trust copy instead of raw decimals.
class VerifyScreen extends ConsumerStatefulWidget {
  const VerifyScreen({super.key});

  @override
  ConsumerState<VerifyScreen> createState() => _VerifyScreenState();
}

class _VerifyScreenState extends ConsumerState<VerifyScreen> {
  final _phone = TextEditingController();
  final _email = TextEditingController();
  final _code = TextEditingController();
  bool _isEmail = false;
  bool _codeSent = false;
  bool _busy = false;
  String? _contactError;
  String? _codeError;
  int _resendIn = 0;
  Timer? _timer;

  @override
  void dispose() {
    _timer?.cancel();
    _phone.dispose();
    _email.dispose();
    _code.dispose();
    super.dispose();
  }

  String get _contact =>
      (_isEmail ? _email.text : _phone.text).trim();

  void _startResendTimer() {
    _timer?.cancel();
    setState(() => _resendIn = 30);
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) return t.cancel();
      setState(() => _resendIn = _resendIn - 1);
      if (_resendIn <= 0) t.cancel();
    });
  }

  Future<void> _send() async {
    setState(() => _contactError = null);
    if (_contact.isEmpty) {
      setState(() => _contactError =
          _isEmail ? 'Enter your email first.' : 'Enter your phone first.');
      return;
    }
    if (_isEmail && !_contact.contains('@')) {
      setState(
          () => _contactError = 'That email does not look right.');
      return;
    }
    setState(() => _busy = true);
    try {
      await ref.read(authProvider.notifier).sendCode(
            phone: _isEmail ? null : _contact,
            email: _isEmail ? _contact : null,
          );
      setState(() => _codeSent = true);
      _startResendTimer();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
              content: Text('Code sent — it works for 10 minutes.')),
        );
      }
    } catch (_) {
      if (mounted) {
        setState(() => _contactError =
            'Could not send the code. Check your connection and retry.');
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _verify() async {
    setState(() => _codeError = null);
    if (_code.text.trim().length != 6) {
      setState(() => _codeError = 'Enter the 6-digit code.');
      return;
    }
    setState(() => _busy = true);
    try {
      await ref.read(authProvider.notifier).verifyCode(
            phone: _isEmail ? null : _contact,
            email: _isEmail ? _contact : null,
            code: _code.text.trim(),
          );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
              content: Text('Verified — your reports now rank higher.')),
        );
        Navigator.maybePop(context);
      }
    } catch (_) {
      if (mounted) {
        setState(() => _codeError =
            'Wrong or expired code. Resend and try again.');
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
              onSelectionChanged: (s) =>
                  setState(() => _isEmail = s.first),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _isEmail ? _email : _phone,
              keyboardType: _isEmail
                  ? TextInputType.emailAddress
                  : TextInputType.phone,
              autofillHints: _isEmail
                  ? const [AutofillHints.email]
                  : const [AutofillHints.telephoneNumber],
              decoration: InputDecoration(
                labelText: _isEmail ? 'Email' : 'Phone',
                border: const OutlineInputBorder(),
                errorText: _contactError,
              ),
            ),
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed:
                  (_busy || (_codeSent && _resendIn > 0)) ? null : _send,
              child: Text(_codeSent
                  ? (_resendIn > 0
                      ? 'Resend in ${_resendIn}s'
                      : 'Resend code')
                  : 'Send code'),
            ),
            if (_codeSent) ...[
              const SizedBox(height: 12),
              TextField(
                controller: _code,
                keyboardType: TextInputType.number,
                autofillHints: const [AutofillHints.oneTimeCode],
                maxLength: 6,
                decoration: InputDecoration(
                  labelText: '6-digit code',
                  border: const OutlineInputBorder(),
                  errorText: _codeError,
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
              auth.verified
                  ? 'Verified — your reports rank higher and triage faster.'
                  : 'Anonymous right now — verifying lifts your reports above the crowd.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      ),
    );
  }
}
