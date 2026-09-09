export type IncidentStatus =
  | "processing"
  | "needs_review"
  | "verified"
  | "rejected"
  | "escalated"
  | "resolved"
  | "awaiting_verification"
  | "community_confirmed"
  | "needs_follow_up"
  | "closed";

export type Severity = "low" | "medium" | "high" | "critical";

export type InsightActionPriority = "immediate" | "priority" | "routine";

export interface InsightActionPlan {
  priority: InsightActionPriority;
  objective: string;
  authority: string;
  immediate_steps: string[];
  escalate_when: string[];
  verify: string;
}

export interface Incident {
  id: string;
  title: string;
  description: string;
  photo_url?: string | null;
  lat: number;
  lng: number;
  address?: string | null;
  status: IncidentStatus;
  severity: Severity;
  ai_confidence?: number | null;
  ai_analysis?: Record<string, unknown> | null;
  reporter_id?: string;
  assigned_to?: string | null;
  created_at: string;
}

export interface Hotspot {
  id: string;
  category: string;
  centroid: { lat: number; lng: number };
  report_count: number;
  unique_contributors: number;
  first_observed: string;
  last_observed: string;
  severity_summary: Record<string, number>;
  persistence_score: number;
  trend: "rising" | "stable" | "declining" | "isolated";
  mean_distance_km: number;
  report_ids: string[];
  explanation: string;
  action_plan: InsightActionPlan;
}

export interface InsightMapPoint {
  id: string;
  lat: number;
  lng: number;
  title: string;
  status: IncidentStatus;
  severity: Severity;
  category: string;
  created_at: string | null;
}

export interface InsightBounds {
  min_lat: number;
  min_lng: number;
  max_lat: number;
  max_lng: number;
}

export interface InsightsFilters {
  window_days: 7 | 30 | 90;
  radius_km: string;
  category: string;
  severity: string;
  trend: string;
  status: string;
  bounds: InsightBounds | null;
}

export interface InsightsSnapshot {
  generated_at: string;
  scope: {
    window_days: number;
    radius_km: number;
    center: { lat: number; lng: number } | null;
    bounds: InsightBounds | null;
    category: string | null;
    severity: string | null;
    trend: string | null;
    status: string;
  };
  summary: {
    total: number;
    by_category: { name: string; count: number }[];
    by_severity: { severity: string; count: number }[];
    by_day: { date: string; count: number }[];
  };
  narratives: Hotspot[];
  signal_count: number;
  map_points: InsightMapPoint[];
}

export interface IncidentNote {
  id: string;
  incident_id: string;
  staff_id?: string | null;
  note: string;
  created_at: string;
}

export interface StatusHistoryEntry {
  id: string;
  incident_id: string;
  old_status: string | null;
  new_status: string;
  changed_by?: string | null;
  changed_at: string;
}

export interface IncidentReporter {
  id: string;
  device_id?: string | null;
  phone?: string | null;
  email?: string | null;
  verified: boolean;
  trust_score: number;
}

export interface IncidentDetail extends Incident {
  notes: IncidentNote[];
  history: StatusHistoryEntry[];
  resolution_evidence: ResolutionEvidence[];
  reporter?: IncidentReporter | null;
}

export type ResolutionEvidenceType = "authority_resolution" | "community_follow_up";
export type ResolutionReviewOutcome = "not_applicable" | "pending" | "confirmed" | "needs_follow_up";

export interface ResolutionEvidence {
  id: string;
  incident_id?: string;
  parent_evidence_id?: string | null;
  hotspot_snapshot_id?: string | null;
  evidence_type: ResolutionEvidenceType;
  submitted_by?: string;
  note: string;
  photo_url?: string | null;
  has_photo: boolean;
  review_outcome: ResolutionReviewOutcome;
  review_note?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  created_at: string;
}

export interface AnalyticsSummary {
  by_category: { name: string; count: number }[];
  by_status: { status: string; count: number }[];
  by_severity: { severity: string; count: number }[];
  by_day: { date: string; count: number; resolved?: number; open?: number; critical?: number }[];
  total?: number;
}

export interface StaffMember {
  id: string;
  email: string;
  role: string;
  open_count: number;
}

export interface DuplicatePair {
  a_id: string;
  b_id: string;
  title: string;
  distance_m: number;
  hours_apart: number;
  score: number;
}

/** Staff display name from email — never a raw UUID in the UI. */
export function staffName(email: string | null | undefined, id?: string | null): string {
  if (email) {
    const prefix = email.split("@")[0];
    if (prefix) return prefix;
  }
  return id ? `staff ${id.slice(0, 8)}` : "staff";
}

export interface StaffUser {
  id: string;
  email: string;
  role: string;
}

export interface AppUser {
  id: string;
  device_id?: string;
  phone?: string | null;
  email?: string | null;
  verified: boolean;
  trust_score: number;
  banned?: boolean;
  created_at: string;
}
