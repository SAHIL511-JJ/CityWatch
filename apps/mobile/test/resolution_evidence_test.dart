import 'package:flutter_test/flutter_test.dart';

import 'package:incident_reporter/api_client.dart';

void main() {
  test('resolution evidence parser keeps only safe citizen fields', () {
    final item = ResolutionEvidenceItem.fromJson({
      'id': 'evidence-1',
      'evidence_type': 'community_follow_up',
      'note': 'The drain is still blocked.',
      'review_outcome': 'pending',
      'has_photo': true,
      'submitted_by': 'must-not-be-used-by-ui',
      'hotspot_snapshot_id': 'private-snapshot',
    });

    expect(item.id, 'evidence-1');
    expect(item.evidenceType, 'community_follow_up');
    expect(item.note, 'The drain is still blocked.');
    expect(item.reviewOutcome, 'pending');
    expect(item.hasPhoto, isTrue);
    expect(item.isAuthority, isFalse);
  });
}
