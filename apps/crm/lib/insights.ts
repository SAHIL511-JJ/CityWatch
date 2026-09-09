import { buildQuery } from "./api";
import type { InsightBounds, InsightsFilters } from "./types";

const WINDOWS = [7, 30, 90] as const;
const DEFAULT_FILTERS: InsightsFilters = {
  window_days: 30,
  radius_km: "0.75",
  category: "",
  severity: "",
  trend: "",
  status: "verified",
  bounds: null,
};

export function localDayKey(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function buildReplayDays(windowDays: number, values: Array<{ created_at?: string | null }>): { date: string; count: number }[] {
  const counts = new Map<string, number>();
  values.forEach((value) => {
    const day = localDayKey(value.created_at);
    if (day) counts.set(day, (counts.get(day) ?? 0) + 1);
  });
  const today = new Date();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Array.from({ length: windowDays }, (_, index) => {
    const date = new Date(end);
    date.setDate(end.getDate() - (windowDays - index - 1));
    const day = localDayKey(date) as string;
    return { date: day, count: counts.get(day) ?? 0 };
  });
}

function validNumber(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readBounds(params: URLSearchParams): InsightBounds | null {
  const values = ["min_lat", "min_lng", "max_lat", "max_lng"].map((key) => validNumber(params.get(key)));
  if (values.some((value) => value === null)) return null;
  const [minLat, minLng, maxLat, maxLng] = values as number[];
  if (minLat > maxLat || minLng > maxLng) return null;
  return { min_lat: minLat, min_lng: minLng, max_lat: maxLat, max_lng: maxLng };
}

export function readInsightsFilters(params: URLSearchParams): InsightsFilters {
  const parsedWindow = Number(params.get("window_days"));
  const window_days = WINDOWS.includes(parsedWindow as (typeof WINDOWS)[number])
    ? (parsedWindow as InsightsFilters["window_days"])
    : DEFAULT_FILTERS.window_days;
  return {
    window_days,
    radius_km: params.get("radius_km") || DEFAULT_FILTERS.radius_km,
    category: params.get("category") || "",
    severity: params.get("severity") || "",
    trend: ["rising", "stable", "declining", "isolated"].includes(params.get("trend") || "") ? params.get("trend")! : "",
    status: [
      "all",
      "verified",
      "escalated",
      "resolved",
      "awaiting_verification",
      "community_confirmed",
      "needs_follow_up",
      "closed",
    ].includes(params.get("status") || "")
      ? params.get("status")!
      : "verified",
    bounds: readBounds(params),
  };
}

export function insightsQuery(filters: InsightsFilters, limit?: number): string {
  return buildQuery({
    window_days: String(filters.window_days),
    radius_km: filters.radius_km,
    limit: limit ? String(limit) : undefined,
    category: filters.category || undefined,
    severity: filters.severity || undefined,
    trend: filters.trend || undefined,
    status: filters.status,
    min_lat: filters.bounds ? String(filters.bounds.min_lat) : undefined,
    min_lng: filters.bounds ? String(filters.bounds.min_lng) : undefined,
    max_lat: filters.bounds ? String(filters.bounds.max_lat) : undefined,
    max_lng: filters.bounds ? String(filters.bounds.max_lng) : undefined,
  });
}

export function signalHref(signalId: string, filters: InsightsFilters): string {
  return `/analytics/${encodeURIComponent(signalId)}${insightsQuery(filters)}`;
}

export function filtersEqual(left: InsightsFilters, right: InsightsFilters): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export { DEFAULT_FILTERS };
