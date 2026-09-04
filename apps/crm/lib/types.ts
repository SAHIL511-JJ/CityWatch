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

export interface IncidentDetail extends Incident {
  notes: IncidentNote[];
  history: StatusHistoryEntry[];
}

export interface AnalyticsSummary {
  by_category: { name: string; count: number }[];
  by_status: { status: string; count: number }[];
  by_day: { date: string; count: number }[];
  total?: number;
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
