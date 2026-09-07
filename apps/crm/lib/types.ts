export type IncidentStatus =
  | "processing"
  | "needs_review"
  | "verified"
  | "rejected"
  | "escalated"
  | "resolved"
  | "closed";

export type Severity = "low" | "medium" | "high" | "critical";

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
  reporter?: IncidentReporter | null;
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
