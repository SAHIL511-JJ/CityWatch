"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/ui/card";
import { FeedbackPanel } from "@/components/ui/feedback-panel";
import { PageHeader } from "@/components/ui/page-header";
import { InsightsMap, type MapBounds } from "@/components/map";
import { InsightsTimeline } from "@/components/insights-timeline";
import { InsightActionPlan } from "@/components/insight-action-plan";
import { apiFetch } from "@/lib/api";
import { NavigationLink } from "@/components/ui/navigation-link";
import { categoryLabel } from "@/lib/taxonomy";
import { buildReplayDays, DEFAULT_FILTERS, insightsQuery, localDayKey, readInsightsFilters, signalHref } from "@/lib/insights";
import type { Hotspot, Incident, InsightsFilters, InsightsSnapshot } from "@/lib/types";

const FONT = { fontFamily: "Verdana, Geneva, sans-serif" } as const;
const CATEGORY_COLORS = ["#2a4a33", "#c2633a", "#35658a", "#806b9a", "#317c73", "#b5822b"];
const SEVERITY_COLORS: Record<string, string> = {
  critical: "#b83b3b",
  high: "#c45a32",
  medium: "#b5822b",
  low: "#278557",
};

const INSIGHT_PRESETS: Array<{ id: string; label: string; hint: string; filters: InsightsFilters }> = [
  {
    id: "recent",
    label: "Citywide recent",
    hint: "7 days · verified",
    filters: { ...DEFAULT_FILTERS, window_days: 7 },
  },
  {
    id: "critical",
    label: "Critical now",
    hint: "7 days · critical",
    filters: { ...DEFAULT_FILTERS, window_days: 7, severity: "critical", status: "all" },
  },
  {
    id: "recurring",
    label: "Rising signals",
    hint: "30 days · rising",
    filters: { ...DEFAULT_FILTERS, trend: "rising" },
  },
];

function humanize(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateTime(value: string | null | undefined): string {
  if (!value) return "Unknown time";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function shortDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function scoreLabel(score: number): string {
  if (score >= 80) return "Strong recurring signal";
  if (score >= 60) return "Established signal";
  return "Emerging signal";
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-2xl bg-zinc-200/70 ${className}`} />;
}

function Metric({ label, value, tone = "default" }: { label: string; value: string | number; tone?: "default" | "green" }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{label}</p>
      <p className={`mt-1 truncate text-lg font-bold tabular-nums ${tone === "green" ? "text-[#2a4a33]" : "text-[#14231a]"}`}>{value}</p>
    </div>
  );
}

function FilterBar({
  filters,
  categories,
  onChange,
  onPreset,
  onClear,
  onRefresh,
  refreshing,
  mapUpdating,
}: {
  filters: InsightsFilters;
  categories: { name: string; count: number }[];
  onChange: (next: Partial<InsightsFilters>) => void;
  onPreset: (next: InsightsFilters) => void;
  onClear: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  mapUpdating: boolean;
}) {
  const activeFilters = [
    filters.window_days !== DEFAULT_FILTERS.window_days ? { key: "window_days", label: `${filters.window_days}-day window`, clear: { window_days: DEFAULT_FILTERS.window_days } } : null,
    filters.radius_km !== DEFAULT_FILTERS.radius_km ? { key: "radius_km", label: `Radius ${filters.radius_km} km`, clear: { radius_km: DEFAULT_FILTERS.radius_km } } : null,
    filters.category ? { key: "category", label: `Category: ${categoryLabel(filters.category)}`, clear: { category: "" } } : null,
    filters.severity ? { key: "severity", label: `Severity: ${humanize(filters.severity)}`, clear: { severity: "" } } : null,
    filters.trend ? { key: "trend", label: `Trend: ${humanize(filters.trend)}`, clear: { trend: "" } } : null,
    filters.status !== DEFAULT_FILTERS.status ? { key: "status", label: `Status: ${filters.status === "all" ? "All operational" : humanize(filters.status)}`, clear: { status: DEFAULT_FILTERS.status } } : null,
    filters.bounds ? { key: "bounds", label: "Map area", clear: { bounds: null } } : null,
  ].filter(Boolean) as Array<{ key: string; label: string; clear: Partial<InsightsFilters> }>;
  const modifiers = activeFilters.filter((item) => item.key !== "window_days" && item.key !== "status" && item.key !== "bounds");
  const isPresetActive = (preset: InsightsFilters) => (
    filters.window_days === preset.window_days
    && filters.radius_km === preset.radius_km
    && filters.category === preset.category
    && filters.severity === preset.severity
    && filters.trend === preset.trend
    && filters.status === preset.status
    && filters.bounds === null
  );

  return (
    <section aria-label="Insight scope controls" className="rounded-2xl border border-[#dfe5dd] bg-white p-4 lg:p-5">
      <div className="flex flex-col gap-3.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#55705c]">Investigation scope</p>
            <p className="mt-1 text-sm text-zinc-600">Choose a saved view, then narrow it only when the evidence calls for it.</p>
          </div>
          <button type="button" onClick={onRefresh} disabled={refreshing} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#14231a] px-4 py-2.5 text-sm font-semibold text-white transition duration-200 hover:bg-[#285e4a] focus:outline-none focus:ring-2 focus:ring-[#2a4a33] focus:ring-offset-2 active:translate-y-px disabled:cursor-wait disabled:opacity-60">
            <span aria-hidden>{refreshing ? "○" : "↻"}</span>{refreshing ? "Refreshing" : "Refresh data"}
          </button>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {INSIGHT_PRESETS.map((preset) => {
            const selected = isPresetActive(preset.filters);
            return (
              <button
                key={preset.id}
                type="button"
                aria-label={`${preset.label}: ${preset.hint}`}
                aria-pressed={selected}
                onClick={() => onPreset(preset.filters)}
                className={`rounded-xl border px-3.5 py-3 text-left transition focus:outline-none focus:ring-2 focus:ring-[#2a4a33] focus:ring-offset-1 ${selected ? "border-[#2a4a33] bg-[#edf5ed] shadow-[inset_0_0_0_1px_rgba(42,74,51,0.08)]" : "border-[#dfe5dd] bg-[#fbfcfa] hover:border-[#b8ccb9] hover:bg-[#f1f6ef]"}`}
              >
                <span className="flex items-center justify-between gap-2"><span className="block text-xs font-bold text-[#14231a]">{preset.label}</span>{selected && <span className="rounded-full bg-[#2a4a33] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-white">Current</span>}</span>
                <span className="mt-1 block text-[11px] text-zinc-500">{preset.hint}</span>
              </button>
            );
          })}
        </div>
        <details className="rounded-xl border border-[#e4e9e2] bg-[#fbfcfa]">
          <summary className="cursor-pointer list-none px-3.5 py-3 text-sm font-semibold text-[#14231a] focus:outline-none focus:ring-2 focus:ring-[#2a4a33] focus:ring-inset">
            <span className="inline-flex items-center gap-2"><span aria-hidden>＋</span>Advanced filters</span>
            {activeFilters.length > 0 && <span className="ml-2 rounded-full bg-[#dce8dc] px-2 py-0.5 text-[10px] font-bold text-[#2a4a33]">{activeFilters.length} active</span>}
          </summary>
          <div className="grid grid-cols-1 gap-3 border-t border-[#e4e9e2] p-3.5 sm:grid-cols-2 lg:grid-cols-5">
            <label className="text-xs font-semibold text-zinc-600">
              Time window
              <select value={filters.window_days} onChange={(event) => onChange({ window_days: Number(event.target.value) as InsightsFilters["window_days"] })} className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm font-normal text-zinc-800 outline-none transition focus:border-[#2a4a33] focus:ring-2 focus:ring-[#dce8dc]">
                <option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option>
              </select>
            </label>
            <label className="text-xs font-semibold text-zinc-600">
              Clustering radius
            <select value={filters.radius_km} onChange={(event) => onChange({ radius_km: event.target.value })} className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm font-normal text-zinc-800 outline-none transition focus:border-[#2a4a33] focus:ring-2 focus:ring-[#dce8dc]">
              <option value="0.25">250 m</option>
              <option value="0.5">500 m</option>
              <option value="0.75">750 m</option>
              <option value="1.5">1.5 km</option>
              <option value="3">3 km</option>
            </select>
          </label>
          <label className="text-xs font-semibold text-zinc-600">
            Category
            <select value={filters.category} onChange={(event) => onChange({ category: event.target.value })} className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm font-normal text-zinc-800 outline-none transition focus:border-[#2a4a33] focus:ring-2 focus:ring-[#dce8dc]">
              <option value="">All categories</option>
              {categories.map((item) => <option key={item.name} value={item.name}>{categoryLabel(item.name)}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-zinc-600">
            Severity
            <select value={filters.severity} onChange={(event) => onChange({ severity: event.target.value })} className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm font-normal capitalize text-zinc-800 outline-none transition focus:border-[#2a4a33] focus:ring-2 focus:ring-[#dce8dc]">
              <option value="">All severities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>
          <label className="text-xs font-semibold text-zinc-600">
            Trend
            <select value={filters.trend} onChange={(event) => onChange({ trend: event.target.value })} className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm font-normal text-zinc-800 outline-none transition focus:border-[#2a4a33] focus:ring-2 focus:ring-[#dce8dc]">
              <option value="">All trends</option>
              <option value="rising">Rising</option>
              <option value="stable">Stable</option>
              <option value="declining">Declining</option>
              <option value="isolated">Isolated</option>
            </select>
          </label>
          <label className="text-xs font-semibold text-zinc-600">
            Report status
            <select value={filters.status} onChange={(event) => onChange({ status: event.target.value })} className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm font-normal text-zinc-800 outline-none transition focus:border-[#2a4a33] focus:ring-2 focus:ring-[#dce8dc]">
              <option value="all">All operational</option>
              <option value="verified">Verified</option>
              <option value="resolved">Resolved</option>
              <option value="awaiting_verification">Awaiting verification</option>
              <option value="community_confirmed">Community confirmed</option>
              <option value="needs_follow_up">Needs follow-up</option>
              <option value="closed">Closed</option>
            </select>
          </label>
            <div className="flex items-end sm:col-span-2 lg:col-span-5">
              <button type="button" onClick={onClear} className="text-xs font-semibold text-[#2a4a33] underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-[#2a4a33]">Clear all filters</button>
            </div>
          </div>
        </details>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3 text-xs text-zinc-500">
        <span className="font-semibold text-[#14231a]">Current scope</span>
        <span className="rounded-full bg-[#eef3ed] px-2.5 py-1 font-semibold text-[#2a4a33]">{filters.window_days} days</span>
        <span className="rounded-full bg-[#eef3ed] px-2.5 py-1 font-semibold text-[#2a4a33]">{filters.status === "all" ? "All operational" : `${humanize(filters.status)} reports`}</span>
        <span className="rounded-full bg-[#eef3ed] px-2.5 py-1 font-semibold text-[#2a4a33]">{filters.bounds ? "Map area" : "Citywide"}</span>
        <span className="rounded-full bg-[#eef3ed] px-2.5 py-1 font-semibold text-[#2a4a33]">{filters.radius_km} km groups</span>
        {modifiers.map((item) => (
          <span key={item.key} className="inline-flex items-center gap-1 rounded-full bg-[#eef3ed] px-2.5 py-1 text-[#2a4a33]">
            {item.label}
            <button type="button" aria-label={`Remove ${item.label}`} onClick={() => onChange(item.clear)} className="rounded-full px-1 font-bold hover:bg-[#dce8dc] focus:outline-none focus:ring-1 focus:ring-[#2a4a33]">×</button>
          </span>
        ))}
        <span className="text-zinc-300">·</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#2a4a33]" />High-confidence evidence</span>
        {filters.bounds ? <button type="button" onClick={() => onChange({ bounds: null })} className="font-semibold text-[#2a4a33] underline-offset-2 hover:underline">Clear map area</button> : <span>Pan the map to narrow the area</span>}
        {mapUpdating && <span className="inline-flex items-center gap-1.5 text-[#2a4a33]"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#2a4a33]" />Updating map area</span>}
      </div>
    </section>
  );
}

function SignalCard({ signal, filters, featured = false, selectedCategory = null }: { signal: Hotspot; filters: InsightsFilters; featured?: boolean; selectedCategory?: string | null }) {
  const relatedToMapSelection = selectedCategory === signal.category;
  return (
    <article aria-label={`${categoryLabel(signal.category)} signal`} className={`relative rounded-2xl border p-5 transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_30px_rgba(20,35,26,0.08)] ${relatedToMapSelection ? "border-[#2a4a33] bg-[#f1f6ef] ring-2 ring-[#b8ccb9]" : featured ? "border-[#b8ccb9] bg-[#f1f6ef]" : "border-[#dfe5dd] bg-white"}`}>
      <span className="absolute inset-y-0 left-0 w-1 rounded-l-2xl" style={{ backgroundColor: signal.persistence_score >= 80 ? "#2a4a33" : "#c8a34b" }} />
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">{featured ? "Priority signal" : "Recurring signal"}</p>
          <h2 className="mt-2 truncate text-xl font-bold tracking-[-0.02em] text-[#14231a]">{categoryLabel(signal.category)}</h2>
          <p className="mt-1 text-sm font-medium text-[#55705c]">{scoreLabel(signal.persistence_score)}{relatedToMapSelection && <span className="ml-2 rounded-full bg-[#dce8dc] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#2a4a33]">Map selection</span>}</p>
        </div>
        <div className="shrink-0 text-right"><p className="text-3xl font-bold tabular-nums text-[#14231a]">{signal.persistence_score}</p><p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500" title="A 0–100 score combining recurrence, spread, contributor diversity, confidence, and recency">signal score ⓘ</p></div>
      </div>
      <p className="mt-5 max-w-[62ch] text-sm leading-6 text-zinc-700">{signal.explanation}</p>
      <div className="mt-5"><InsightActionPlan plan={signal.action_plan} compact={!featured} presentation={featured ? "stacked" : "default"} /></div>
      <div className="mt-5 grid grid-cols-2 gap-3 border-y border-black/10 py-4 xl:grid-cols-4"><Metric label="Reports" value={signal.report_count} /><Metric label="Contributors" value={signal.unique_contributors} /><Metric label="Mean spread" value={`${signal.mean_distance_km.toFixed(2)} km`} /><Metric label="Trend" value={humanize(signal.trend)} /></div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-zinc-500">Last observed {dateTime(signal.last_observed)}</p><NavigationLink href={signalHref(signal.id, filters)} className="rounded-lg bg-[#14231a] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#285e4a] focus:outline-none focus:ring-2 focus:ring-[#2a4a33] focus:ring-offset-2">Open evidence page →</NavigationLink></div>
    </article>
  );
}

function RankedSignalRow({ signal, filters, rank, selectedCategory = null }: { signal: Hotspot; filters: InsightsFilters; rank: number; selectedCategory?: string | null }) {
  const relatedToMapSelection = selectedCategory === signal.category;
  return (
    <article className={`grid gap-3 rounded-xl border p-4 transition sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center ${relatedToMapSelection ? "border-[#2a4a33] bg-[#f1f6ef] ring-1 ring-[#b8ccb9]" : "border-[#dfe5dd] bg-white hover:border-[#b8ccb9] hover:bg-[#fbfcfa]"}`}>
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#eef3ed] text-xs font-bold tabular-nums text-[#2a4a33]">{rank}</span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><h3 className="text-base font-bold text-[#14231a]">{categoryLabel(signal.category)}</h3><span className="rounded-full bg-[#f4f6f3] px-2 py-0.5 text-[10px] font-bold capitalize text-[#55705c]">{signal.trend}</span>{relatedToMapSelection && <span className="rounded-full bg-[#dce8dc] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#2a4a33]">Map selection</span>}</div>
        <p className="mt-1 truncate text-xs leading-5 text-zinc-600">{signal.report_count} reports · {signal.unique_contributors} contributors · last observed {dateTime(signal.last_observed)}</p>
      </div>
      <div className="flex items-center justify-between gap-4 sm:justify-end"><div className="text-left sm:text-right"><p className="text-lg font-bold tabular-nums text-[#14231a]">{signal.persistence_score}</p><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">signal score</p></div><NavigationLink href={signalHref(signal.id, filters)} className="rounded-lg border border-[#b8ccb9] px-3 py-2 text-xs font-semibold text-[#2a4a33] transition hover:bg-[#edf5ed] focus:outline-none focus:ring-2 focus:ring-[#2a4a33] focus:ring-offset-2">Inspect →</NavigationLink></div>
    </article>
  );
}

function SignalDefinitions() {
  return (
    <details className="group rounded-2xl border border-[#dfe5dd] bg-white p-5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl text-sm font-bold text-[#14231a] transition-colors hover:bg-[#f7faf6] focus:outline-none focus:ring-2 focus:ring-[#2a4a33] focus:ring-offset-2">
        <span className="flex min-w-0 items-center gap-3"><span aria-hidden className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#b8ccb9] bg-[#f1f6ef] text-[#2a4a33] transition-colors group-hover:bg-[#dce8dc]"><svg viewBox="0 0 16 16" className="h-3.5 w-3.5 transition-transform duration-200 group-open:rotate-180" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></span><span>How to read signal metrics</span></span>
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.14em] text-[#55705c]"><span className="group-open:hidden">Expand</span><span className="hidden group-open:inline">Collapse</span></span>
      </summary>
      <dl className="mt-4 grid gap-3 border-t border-zinc-100 pt-4 sm:grid-cols-2">
        <div><dt className="text-xs font-bold text-[#14231a]">Signal score</dt><dd className="mt-1 text-xs leading-5 text-zinc-600">A 0–100 priority score combining recurrence, spread, contributor diversity, confidence, and recency.</dd></div>
        <div><dt className="text-xs font-bold text-[#14231a]">Trend</dt><dd className="mt-1 text-xs leading-5 text-zinc-600">Rising means the signal is becoming more active; stable, declining, and isolated describe the observed pattern.</dd></div>
        <div><dt className="text-xs font-bold text-[#14231a]">Mean spread</dt><dd className="mt-1 text-xs leading-5 text-zinc-600">The average distance between reports in this signal, not the size of the affected area.</dd></div>
        <div><dt className="text-xs font-bold text-[#14231a]">Contributors</dt><dd className="mt-1 text-xs leading-5 text-zinc-600">Distinct reporters represented in the signal, used to distinguish repeated evidence from one source.</dd></div>
      </dl>
    </details>
  );
}

function SelectedPoint({ point, category, relatedSignal, filters, onFocusCategory }: { point: Incident; category: string; relatedSignal?: Hotspot | null; filters: InsightsFilters; onFocusCategory: () => void }) {
  return (
    <div className="rounded-2xl border border-[#cbdacb] bg-[#f1f6ef] p-4">
      <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#55705c]">Selected map report</p><h3 className="mt-1 text-base font-bold text-[#14231a]">{point.title}</h3></div><span className="rounded-md bg-white px-2 py-1 text-[10px] font-semibold capitalize text-[#55705c]">{point.severity}</span></div>
      <p className="mt-3 text-xs leading-5 text-zinc-600">{point.description}</p>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500"><span>{dateTime(point.created_at)}</span><span className="capitalize">{point.status.replaceAll("_", " ")}</span><span>{categoryLabel(category)}</span></div>
      <div className="mt-4 flex flex-wrap gap-3">
        <NavigationLink href={`/incidents/${point.id}`} className="inline-flex text-xs font-semibold text-[#2a4a33] underline-offset-2 hover:underline">Open incident record →</NavigationLink>
        {relatedSignal && <NavigationLink href={signalHref(relatedSignal.id, filters)} className="inline-flex text-xs font-semibold text-[#2a4a33] underline-offset-2 hover:underline">Open related {categoryLabel(relatedSignal.category)} signal →</NavigationLink>}
        <button type="button" onClick={onFocusCategory} className="inline-flex text-xs font-semibold text-[#2a4a33] underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-[#2a4a33]">Focus {categoryLabel(category)} signals →</button>
      </div>
    </div>
  );
}

function AnalyticsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialFilters = useMemo(() => readInsightsFilters(searchParams), [searchParams]);
  const [filters, setFilters] = useState<InsightsFilters>(initialFilters);
  const [timelineDate, setTimelineDate] = useState<string | null>(null);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<Incident | null>(null);
  const [selectedPointCategory, setSelectedPointCategory] = useState<string | null>(null);
  const [selectedPointLoading, setSelectedPointLoading] = useState(false);
  const [selectedPointError, setSelectedPointError] = useState<string | null>(null);
  const [mapUpdating, setMapUpdating] = useState(false);
  const mapTimer = useRef<number | null>(null);
  const pointRequest = useRef(0);

  useEffect(() => {
    const nextQuery = insightsQuery(filters);
    if (searchParams.toString() !== nextQuery.slice(1)) router.replace(`/analytics${nextQuery}`, { scroll: false });
  }, [filters, initialFilters, router, searchParams]);

  const query = insightsQuery(filters);
  const mapFitKey = useMemo(() => insightsQuery({ ...filters, bounds: null }), [filters]);
  const insights = useQuery({ queryKey: ["admin-insights", query], queryFn: () => apiFetch<InsightsSnapshot>(`/admin/insights${query}`), staleTime: 30000, placeholderData: keepPreviousData });
  const data = insights.data;
  const narratives = data?.narratives ?? [];
  const lead = narratives[0];
  const categories = data?.summary.by_category ?? [];
  const criticalReports = data?.summary.by_severity.find((item) => item.severity === "critical")?.count ?? 0;
  const days = useMemo(() => buildReplayDays(filters.window_days, data?.map_points ?? []), [data?.map_points, filters.window_days]);
  const selectedDay = timelineDate ?? days.at(-1)?.date ?? null;
  const visiblePoints = useMemo(() => selectedDay ? (data?.map_points ?? []).filter((point) => !point.created_at || (localDayKey(point.created_at) ?? "") <= selectedDay) : (data?.map_points ?? []), [data?.map_points, selectedDay]);
  const chartData = useMemo(() => days.map((day) => ({ ...day, label: shortDate(day.date) })), [days]);
  const selectedSignal = selectedPointCategory ? narratives.find((signal) => signal.category === selectedPointCategory) ?? null : null;

  useEffect(() => {
    if (!selectedPointId || visiblePoints.some((point) => point.id === selectedPointId)) return;
    setSelectedPointId(null);
    setSelectedPoint(null);
    setSelectedPointCategory(null);
  }, [selectedPointId, visiblePoints]);

  const updateFilters = useCallback((next: Partial<InsightsFilters>) => {
    setTimelineDate(null);
    setSelectedPointId(null);
    setSelectedPoint(null);
    setSelectedPointCategory(null);
    setSelectedPointError(null);
    setFilters((current) => ({ ...current, ...next }));
  }, []);

  const applyPreset = useCallback((next: InsightsFilters) => {
    setTimelineDate(null);
    setSelectedPointId(null);
    setSelectedPoint(null);
    setSelectedPointCategory(null);
    setSelectedPointError(null);
    setFilters({ ...next });
  }, []);

  const clearFilters = useCallback(() => applyPreset({ ...DEFAULT_FILTERS }), [applyPreset]);

  const onBoundsChange = useCallback((next: MapBounds) => {
    const bounds = { min_lat: next.min_lat, min_lng: next.min_lng, max_lat: next.max_lat, max_lng: next.max_lng };
    setMapUpdating(true);
    if (mapTimer.current) window.clearTimeout(mapTimer.current);
    mapTimer.current = window.setTimeout(() => {
      setFilters((current) => {
        if (current.bounds && JSON.stringify(current.bounds) === JSON.stringify(bounds)) return current;
        return { ...current, bounds };
      });
      setMapUpdating(false);
    }, 450);
  }, []);

  const selectPoint = useCallback(async (point: { id: string; category?: string }) => {
    pointRequest.current += 1;
    const requestId = pointRequest.current;
    setSelectedPointId(point.id);
    setSelectedPointCategory(point.category ?? null);
    setSelectedPoint(null);
    setSelectedPointError(null);
    setSelectedPointLoading(true);
    try {
      const incident = await apiFetch<Incident>(`/admin/incidents/${point.id}`);
      if (requestId === pointRequest.current) setSelectedPoint(incident);
    } catch (error) {
      if (requestId === pointRequest.current) setSelectedPointError(error instanceof Error ? error.message : "The selected report could not be loaded.");
    } finally {
      if (requestId === pointRequest.current) setSelectedPointLoading(false);
    }
  }, []);

  return (
    <div className="mx-auto max-w-[1500px] space-y-6 pb-10" style={FONT}>
      <PageHeader
        eyebrow="Authority intelligence"
        title="Insights"
        description="A focused view of what is repeating, where reports are concentrating, and which signals deserve a closer look."
        meta={<><span className="block">{data ? `Updated ${dateTime(data.generated_at)}` : "Waiting for live data"}</span>{insights.isFetching && !insights.isLoading && <span className="mt-1 block font-semibold text-[#285e4a]" aria-live="polite">Updating evidence…</span>}{filters.bounds && <span className="mt-1 block font-semibold text-[#2a4a33]">Map area is applied</span>}</>}
      />

      <FilterBar filters={filters} categories={categories} onChange={updateFilters} onPreset={applyPreset} onClear={clearFilters} onRefresh={() => insights.refetch()} refreshing={insights.isFetching} mapUpdating={mapUpdating} />

      {insights.isLoading ? <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_360px]"><Skeleton className="h-[600px]" /><Skeleton className="h-[600px]" /></div> : insights.error ? <FeedbackPanel variant="error" title="Insights could not load" description="The operations intelligence service did not return a usable response." action={<button type="button" onClick={() => insights.refetch()} className="rounded-lg bg-[#14231a] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#285e4a] focus:outline-none focus:ring-2 focus:ring-[#2a4a33] focus:ring-offset-2">Retry</button>} /> : <>
        <section className="grid gap-3 sm:grid-cols-3" aria-label="Insight summary">
          <Card className="border-[#dfe5dd] p-4"><Metric label="Matching reports" value={data?.summary.total ?? 0} tone="green" /></Card>
          <Card className="border-[#dfe5dd] p-4"><Metric label="Recurring signals" value={data?.signal_count ?? 0} /></Card>
          <Card className="border-[#dfe5dd] p-4"><Metric label="Critical reports" value={criticalReports} /></Card>
        </section>

        <section className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(22rem,0.9fr)]">
          <Card className="overflow-hidden border-[#dfe5dd] p-0">
            <div className="flex flex-wrap items-end justify-between gap-3 p-5"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#55705c]">Primary investigation</p><h2 className="mt-2 text-2xl font-bold tracking-[-0.03em] text-[#14231a]">Evidence map</h2></div><p className="text-xs text-zinc-500">{visiblePoints.length} reports in scope</p></div>
            <div className="mx-5 mb-4 border-l-2 border-[#b8ccb9] bg-[#f7faf6] px-3.5 py-2.5 text-xs leading-5 text-zinc-600"><span className="font-bold text-[#14231a]">Inspect the evidence:</span> select a cluster or report to connect it with the related signal.</div>
            <InsightsMap points={visiblePoints} fitKey={mapFitKey} selectedId={selectedPointId} onSelect={selectPoint} onBoundsChange={onBoundsChange} height={540} />
            <details className="border-t border-[#e4e9e2] bg-[#fbfcfa]">
              <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-[#14231a] focus:outline-none focus:ring-2 focus:ring-[#2a4a33] focus:ring-inset lg:px-5">Replay reporting <span className="ml-2 text-xs font-normal text-zinc-500">Review how this scope changed by day</span></summary>
              <InsightsTimeline days={days} value={timelineDate} onChange={setTimelineDate} />
            </details>
            <div className="grid gap-4 border-t border-[#e4e9e2] px-5 py-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end"><div><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#55705c]">Map guide</p><p className="mt-1 text-sm leading-6 text-zinc-600">Numbered markers group nearby reports. Zoom in to separate them, then select a report to inspect its evidence.</p></div><div className="grid grid-cols-2 gap-5 border-t border-zinc-100 pt-3 xl:border-t-0 xl:pt-0"><Metric label="Radius" value={`${filters.radius_km} km`} /><Metric label="Scope" value={filters.bounds ? "Map area" : "Citywide"} /></div></div>
          </Card>
          <aside className="min-w-0 space-y-5">
            {lead ? <SignalCard signal={lead} filters={filters} featured selectedCategory={selectedPointCategory} /> : <Card className="flex min-h-[260px] items-center justify-center border-[#dfe5dd] p-8 text-center"><div><p className="text-lg font-bold text-[#14231a]">No recurring signal in this scope</p><p className="mt-2 text-sm leading-6 text-zinc-500">Widen the time window or clear the map area to see more evidence.</p></div></Card>}
            {selectedPointLoading && selectedPointId && <Card className="border-[#cbdacb] bg-[#f1f6ef] p-4" aria-label="Loading selected report"><div className="h-3 w-28 animate-pulse rounded bg-zinc-200" /><div className="mt-3 h-5 w-3/4 animate-pulse rounded bg-zinc-200" /><div className="mt-3 h-12 w-full animate-pulse rounded bg-zinc-100" /></Card>}
            {selectedPointError && selectedPointId && <Card className="border-red-200 bg-red-50 p-4" role="alert"><p className="text-sm font-semibold text-red-900">Selected report could not load</p><p className="mt-1 text-xs leading-5 text-red-700">{selectedPointError}</p><button type="button" onClick={() => selectPoint({ id: selectedPointId, category: selectedPointCategory ?? undefined })} className="mt-3 rounded-md bg-[#14231a] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#2a4a33] focus:outline-none focus:ring-2 focus:ring-[#2a4a33] focus:ring-offset-2">Retry selected report</button></Card>}
            {selectedPoint && selectedPointCategory && <SelectedPoint point={selectedPoint} category={selectedPointCategory} relatedSignal={selectedSignal} filters={filters} onFocusCategory={() => updateFilters({ category: selectedPointCategory })} />}
            <SignalDefinitions />
          </aside>
        </section>

        <details className="group rounded-2xl border border-[#dfe5dd] bg-white">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm font-bold text-[#14231a] transition-colors hover:bg-[#f7faf6] focus:outline-none focus:ring-2 focus:ring-[#2a4a33] focus:ring-inset">
            <span className="flex min-w-0 items-center gap-3"><span aria-hidden className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#b8ccb9] bg-[#f1f6ef] text-[#2a4a33]"><svg viewBox="0 0 16 16" className="h-3.5 w-3.5 transition-transform duration-200 group-open:rotate-180" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></span><span className="min-w-0"><span className="block">Supporting evidence</span><span className="mt-0.5 block text-xs font-normal text-zinc-500">Activity, category mix, and severity mix for the current scope</span></span></span>
            <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.14em] text-[#55705c]"><span className="group-open:hidden">Expand</span><span className="hidden group-open:inline">Collapse</span></span>
          </summary>
          <section className="grid gap-5 border-t border-[#e4e9e2] p-5 lg:grid-cols-[1.25fr_.75fr]">
          <Card className="border-[#dfe5dd] p-5"><div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#55705c]">Reporting rhythm</p><h2 className="mt-2 text-xl font-bold tracking-[-0.02em] text-[#14231a]">Activity in scope</h2></div><span className="rounded-md bg-[#eef3ed] px-2.5 py-1 text-xs font-semibold text-[#2a4a33]">{data?.summary.total ?? 0} reports</span></div><p className="mt-2 text-sm text-zinc-500">Daily reporting volume across the selected window.</p><div className="mt-5 h-56"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} margin={{ top: 8, right: 4, left: -22, bottom: 0 }}><defs><linearGradient id="insightFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2a4a33" stopOpacity={0.26} /><stop offset="100%" stopColor="#2a4a33" stopOpacity={0.02} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="#e4e9e2" /><XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" /><YAxis allowDecimals={false} tick={{ fontSize: 10 }} /><Tooltip /><Area type="monotone" dataKey="count" stroke="#2a4a33" strokeWidth={2.5} fill="url(#insightFill)" /></AreaChart></ResponsiveContainer></div></Card>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1"><Card className="border-[#dfe5dd] p-5"><div className="flex items-start justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#55705c]">Category mix</p><h2 className="mt-2 text-xl font-bold tracking-[-0.02em] text-[#14231a]">What is being reported</h2></div><span className="text-xs text-zinc-500">{data?.signal_count ?? 0} signals</span></div><div className="mt-4 h-40"><ResponsiveContainer width="100%" height="100%"><BarChart data={categories.map((item) => ({ ...item, label: categoryLabel(item.name) }))} layout="vertical" margin={{ top: 0, right: 18, left: 0, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e4e9e2" /><XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} /><YAxis type="category" dataKey="label" width={118} tick={{ fontSize: 10 }} /><Tooltip /><Bar dataKey="count" radius={[0, 5, 5, 0]}>{categories.map((item, index) => <Cell key={item.name} fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]} />)}</Bar></BarChart></ResponsiveContainer></div></Card><Card className="border-[#dfe5dd] p-5"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#55705c]">Severity mix</p><div className="mt-4 space-y-3">{(data?.summary.by_severity ?? []).map((item) => { const total = data?.summary.total || 1; return <div key={item.severity}><div className="mb-1 flex justify-between text-xs"><span className="font-semibold capitalize text-zinc-700">{item.severity}</span><span className="tabular-nums text-zinc-500">{item.count} · {Math.round((item.count / total) * 100)}%</span></div><div className="h-2 overflow-hidden rounded-full bg-zinc-100"><div className="h-full rounded-full transition-all duration-300" style={{ width: `${(item.count / total) * 100}%`, backgroundColor: SEVERITY_COLORS[item.severity] ?? "#71717a" }} /></div></div>; })}</div></Card></div>
          </section>
        </details>

        {narratives.length > 1 && <section className="rounded-2xl border border-[#dfe5dd] bg-white p-5"><div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#55705c]">Ranked evidence</p><h2 className="mt-2 text-2xl font-bold tracking-[-0.03em] text-[#14231a]">Other signals in this scope</h2><p className="mt-1 text-sm text-zinc-600">Compare the next strongest patterns before opening a full evidence page.</p></div><p className="text-xs text-zinc-500">{Math.max(0, narratives.length - 1)} additional signals</p></div><div className="space-y-3">{narratives.slice(1).map((signal, index) => <RankedSignalRow key={signal.id} signal={signal} filters={filters} rank={index + 2} selectedCategory={selectedPointCategory} />)}</div></section>}
      </>}
    </div>
  );
}

export default function AnalyticsPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-[1500px] space-y-5"><Skeleton className="h-24" /><div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_360px]"><Skeleton className="h-[600px]" /><Skeleton className="h-[600px]" /></div></div>}>
      <AnalyticsPageContent />
    </Suspense>
  );
}
