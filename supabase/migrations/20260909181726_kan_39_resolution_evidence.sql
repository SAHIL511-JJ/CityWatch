-- KAN-39: resolution evidence and community verification loop.
-- Supabase Postgres/PostGIS only. The FastAPI service is the access boundary.

CREATE TABLE IF NOT EXISTS resolution_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
  parent_evidence_id UUID REFERENCES resolution_evidence (id) ON DELETE CASCADE,
  hotspot_snapshot_id TEXT,
  evidence_type TEXT NOT NULL,
  submitted_by UUID NOT NULL,
  note TEXT NOT NULL,
  photo_url TEXT NOT NULL,
  review_outcome TEXT NOT NULL DEFAULT 'pending',
  review_note TEXT,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT resolution_evidence_type_check
    CHECK (evidence_type IN ('authority_resolution', 'community_follow_up')),
  CONSTRAINT resolution_evidence_outcome_check
    CHECK (review_outcome IN ('not_applicable', 'pending', 'confirmed', 'needs_follow_up')),
  CONSTRAINT resolution_evidence_note_length_check
    CHECK (char_length(trim(note)) BETWEEN 1 AND 2000),
  CONSTRAINT resolution_evidence_review_note_length_check
    CHECK (review_note IS NULL OR char_length(trim(review_note)) BETWEEN 1 AND 2000),
  CONSTRAINT resolution_evidence_authority_shape_check
    CHECK (
      evidence_type <> 'authority_resolution'
      OR (parent_evidence_id IS NULL AND review_outcome = 'not_applicable')
    ),
  CONSTRAINT resolution_evidence_community_shape_check
    CHECK (
      evidence_type <> 'community_follow_up'
      OR (parent_evidence_id IS NOT NULL AND review_outcome <> 'not_applicable')
    ),
  CONSTRAINT resolution_evidence_pending_shape_check
    CHECK (
      review_outcome <> 'pending'
      OR (review_note IS NULL AND reviewed_by IS NULL AND reviewed_at IS NULL)
    ),
  CONSTRAINT resolution_evidence_reviewed_shape_check
    CHECK (
      review_outcome NOT IN ('confirmed', 'needs_follow_up')
      OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_resolution_evidence_incident_created
  ON resolution_evidence (incident_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_resolution_evidence_parent_created
  ON resolution_evidence (parent_evidence_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_resolution_evidence_outcome_created
  ON resolution_evidence (review_outcome, created_at, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_resolution_evidence_pending_submitter
  ON resolution_evidence (incident_id, parent_evidence_id, submitted_by)
  WHERE evidence_type = 'community_follow_up' AND review_outcome = 'pending';
