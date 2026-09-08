"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { InsightsMap, type MapBounds } from "@/components/map";
import { InsightsTimeline } from "@/components/insights-timeline";
import { InsightActionPlan } from "@/components/insight-action-plan";
import { apiFetch } from "@/lib/api";
import { categoryLabel } from "@/lib/taxonomy";
import { buildReplayDays, insightsQuery, localDayKey, readInsightsFilters, signalHref } from "@/lib/insights";
import type { Hotspot, Incident, InsightsFilters, InsightsSnapshot } from "@/lib/types";

const FONT = { fontFamily: "Verdana, Geneva, sans-serif" } as const;
const CATEGORY_COLORS = ["#2a4a33", "#c2633a", "#35658a", "#806b9a", "#317c73", "#b5822b"];
const SEVERITY_COLORS: Record<string, string> = {
  critical: "#b83b3b",
  high: "#c45a32",
  medium: "#b5822b",
  low: "#278557",
};

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
  onRefresh,
  refreshing,
  mapUpdating,
}: {
  filters: InsightsFilters;
  categories: { name: string; count: number }[];
  onChange: (next: Partial<InsightsFilters>) => void;
  onRefresh: () => void;
  refreshing: boolean;
  mapUpdating: boolean;
}) {
  return (
    <section aria-label="Insight scope controls" className="rounded-2xl border border-[#dfe5dd] bg-white p-4 shadow-[0_8px_25px_rgba(20,35,26,0.05)] lg:p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#55705c]">Scope</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {[7, 30, 90].map((days) => (
              <button
                key={days}
                type="button"
                aria-pressed={filters.window_days === days}
                onClick={() => onChange({ window_days: days as InsightsFilters["window_days"] })}
                className={`rounded-lg px-3.5 py-2 text-xs font-semibold transition duration-200 focus:outline-none focus:ring-2 focus:ring-[#2a4a33] focus:ring-offset-1 active:translate-y-px ${filters.window_days === days ? "bg-[#14231a] text-white shadow-sm" : "bg-[#f0f3ef] text-zinc-600 hover:bg-[#e4ebe3]"}`}
              >
                {days} days
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
        </div>
        <button type="button" onClick={onRefresh} disabled={refreshing} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#14231a] px-4 py-2.5 text-sm font-semibold text-white transition duration-200 hover:bg-[#285e4a] focus:outline-none focus:ring-2 focus:ring-[#2a4a33] focus:ring-offset-2 active:translate-y-px disabled:cursor-wait disabled:opacity-60">
          <span aria-hidden>{refreshing ? "○" : "↻"}</span>{refreshing ? "Refreshing" : "Refresh data"}
        </button>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-zinc-100 pt-3 text-xs text-zinc-500">
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#2a4a33]" />Verified, high-confidence evidence only</span>
        <span className="text-zinc-300">·</span>
        {filters.bounds ? <><span>Map area applied</span><button type="button" onClick={() => onChange({ bounds: null })} className="font-semibold text-[#2a4a33] underline-offset-2 hover:underline">Clear map area</button></> : <span>Move the map to narrow the area</span>}
        {mapUpdating && <span className="inline-flex items-center gap-1.5 text-[#2a4a33]"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#2a4a33]" />Updating map area</span>}
      </div>
    </section>
  );
}

function SignalCard({ signal, filters, featured = false }: { signal: Hotspot; filters: InsightsFilters; featured?: boolean }) {
  return (
    <article className={`relative rounded-2xl border p-5 transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_30px_rgba(20,35,26,0.08)] ${featured ? "border-[#b8ccb9] bg-[#f1f6ef]" : "border-[#dfe5dd] bg-white"}`}>
      <span className="absolute inset-y-0 left-0 w-1 rounded-l-2xl" style={{ backgroundColor: signal.persistence_score >= 80 ? "#2a4a33" : "#c8a34b" }} />
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">{featured ? "Priority signal" : "Recurring signal"}</p>
          <h2 className="mt-2 truncate text-xl font-bold tracking-[-0.02em] text-[#14231a]">{categoryLabel(signal.category)}</h2>
          <p className="mt-1 text-sm font-medium text-[#55705c]">{scoreLabel(signal.persistence_score)}</p>
        </div>
        <div className="shrink-0 text-right"><p className="text-3xl font-bold tabular-nums text-[#14231a]">{signal.persistence_score}</p><p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">signal score</p></div>
      </div>
      <p className="mt-5 max-w-[62ch] text-sm leading-6 text-zinc-700">{signal.explanation}</p>
      <div className="mt-5"><InsightActionPlan plan={signal.action_plan} compact={!featured} /></div>
      <div className="mt-5 grid grid-cols-2 gap-3 border-y border-black/10 py-4 xl:grid-cols-4"><Metric label="Reports" value={signal.report_count} /><Metric label="Contributors" value={signal.unique_contributors} /><Metric label="Mean spread" value={`${signal.mean_distance_km.toFixed(2)} km`} /><Metric label="Trend" value={signal.trend} /></div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-zinc-500">Last observed {dateTime(signal.last_observed)}</p><Link href={signalHref(signal.id, filters)} className="rounded-lg bg-[#14231a] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#285e4a] focus:outline-none focus:ring-2 focus:ring-[#2a4a33] focus:ring-offset-2">Open evidence page →</Link></div>
    </article>
  );
}

function SelectedPoint({ point }: { point: Incident }) {
  return (
    <div className="rounded-2xl border border-[#cbdacb] bg-[#f1f6ef] p-4">
      <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#55705c]">Selected report</p><h3 className="mt-1 text-base font-bold text-[#14231a]">{point.title}</h3></div><span className="rounded-md bg-white px-2 py-1 text-[10px] font-semibold capitalize text-[#55705c]">{point.severity}</span></div>
      <p className="mt-3 text-xs leading-5 text-zinc-600">{point.description}</p>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500"><span>{dateTime(point.created_at)}</span><span className="capitalize">{point.status.replaceAll("_", " ")}</span></div>
      <Link href={`/incidents/${point.id}`} className="mt-4 inline-flex text-xs font-semibold text-[#2a4a33] underline-offset-2 hover:underline">Open incident record →</Link>
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
  const [mapUpdating, setMapUpdating] = useState(false);
  const mapTimer = useRef<number | null>(null);

  useEffect(() => {
    const nextQuery = insightsQuery(filters);
    if (searchParams.toString() !== nextQuery.slice(1)) router.replace(`/analytics${nextQuery}`, { scroll: false });
  }, [filters, initialFilters, router, searchParams]);

  const query = insightsQuery(filters);
  const mapFitKey = useMemo(() => insightsQuery({ ...filters, bounds: null }), [filters]);
  const insights = useQuery({ queryKey: ["admin-insights", query], queryFn: () => apiFetch<InsightsSnapshot>(`/admin/insights${query}`), staleTime: 30000 });
  const data = insights.data;
  const narratives = data?.narratives ?? [];
  const lead = narratives[0];
  const categories = data?.summary.by_category ?? [];
  const days = useMemo(() => buildReplayDays(filters.window_days, data?.map_points ?? []), [data?.map_points, filters.window_days]);
  const selectedDay = timelineDate ?? days.at(-1)?.date ?? null;
  const visiblePoints = useMemo(() => selectedDay ? (data?.map_points ?? []).filter((point) => !point.created_at || (localDayKey(point.created_at) ?? "") <= selectedDay) : (data?.map_points ?? []), [data?.map_points, selectedDay]);
  const chartData = useMemo(() => days.map((day) => ({ ...day, label: shortDate(day.date) })), [days]);

  useEffect(() => {
    if (!selectedPointId || visiblePoints.some((point) => point.id === selectedPointId)) return;
    setSelectedPointId(null);
    setSelectedPoint(null);
  }, [selectedPointId, visiblePoints]);

  const updateFilters = useCallback((next: Partial<InsightsFilters>) => {
    setTimelineDate(null);
    setSelectedPointId(null);
    setSelectedPoint(null);
    setFilters((current) => ({ ...current, ...next }));
  }, []);

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

  const selectPoint = useCallback(async (point: { id: string }) => {
    setSelectedPointId(point.id);
    try {
      setSelectedPoint(await apiFetch<Incident>(`/admin/incidents/${point.id}`));
    } catch {
      setSelectedPoint(null);
    }
  }, []);

  return (
    <div className="mx-auto max-w-[1500px] space-y-6 pb-10" style={FONT}>
      <header className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#55705c]">Authority intelligence</p><h1 className="mt-2 text-4xl font-bold tracking-[-0.05em] text-[#14231a]">Insights</h1><p className="mt-2 max-w-[65ch] text-sm leading-6 text-zinc-600">A focused view of what is repeating, where reports are concentrating, and which signals deserve a closer look.</p></div>
        <div className="text-right"><p className="text-xs text-zinc-500">{data ? `Updated ${dateTime(data.generated_at)}` : "Waiting for live data"}</p>{filters.bounds && <p className="mt-1 text-xs font-semibold text-[#2a4a33]">Map area is applied</p>}</div>
      </header>

      <FilterBar filters={filters} categories={categories} onChange={updateFilters} onRefresh={() => insights.refetch()} refreshing={insights.isFetching} mapUpdating={mapUpdating} />

      {insights.isLoading ? <div className="grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_360px]"><Skeleton className="h-[600px]" /><Skeleton className="h-[600px]" /></div> : insights.error ? <Card className="border-red-200 bg-red-50 p-10 text-center"><p className="text-sm font-semibold text-red-700">Insights could not load from the operations API.</p><button type="button" onClick={() => insights.refetch()} className="mt-4 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white">Retry</button></Card> : <>
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Insight summary">
          <Card className="border-[#dfe5dd] p-4"><Metric label="Verified reports" value={data?.summary.total ?? 0} tone="green" /></Card>
          <Card className="border-[#dfe5dd] p-4"><Metric label="Recurring signals" value={data?.signal_count ?? 0} /></Card>
          <Card className="border-[#dfe5dd] p-4"><Metric label="Visible on map" value={visiblePoints.length} /></Card>
          <Card className="border-[#dfe5dd] p-4"><Metric label="Window" value={`${filters.window_days} days`} /></Card>
        </section>

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_360px]">
          <Card className="overflow-hidden border-[#dfe5dd] p-0">
            <div className="flex flex-wrap items-end justify-between gap-3 p-5"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#55705c]">Geographic concentration</p><h2 className="mt-2 text-2xl font-bold tracking-[-0.03em] text-[#14231a]">Signal map</h2></div><p className="text-xs text-zinc-500">{visiblePoints.length} visible reports · click a cluster to expand</p></div>
            <InsightsMap points={visiblePoints} fitKey={mapFitKey} selectedId={selectedPointId} onSelect={selectPoint} onBoundsChange={onBoundsChange} height={540} />
            <InsightsTimeline days={days} value={timelineDate} onChange={setTimelineDate} />
          </Card>
          <aside className="space-y-5">
            {lead ? <SignalCard signal={lead} filters={filters} featured /> : <Card className="flex min-h-[260px] items-center justify-center border-[#dfe5dd] p-8 text-center"><div><p className="text-lg font-bold text-[#14231a]">No recurring signal in this scope</p><p className="mt-2 text-sm leading-6 text-zinc-500">Widen the time window or clear the map area to see more evidence.</p></div></Card>}
            {selectedPoint ? <SelectedPoint point={selectedPoint} /> : <Card className="border-[#dfe5dd] bg-[#fffdf8] p-5"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#55705c]">How to read this map</p><h3 className="mt-2 text-base font-bold text-[#14231a]">Clusters reveal repetition</h3><p className="mt-2 text-sm leading-6 text-zinc-600">Numbered markers group nearby reports. Zoom in to separate them, then select a report to inspect its evidence record.</p><div className="mt-4 grid grid-cols-2 gap-3 border-t border-zinc-100 pt-4"><Metric label="Radius" value={`${filters.radius_km} km`} /><Metric label="Scope" value={filters.bounds ? "Map area" : "Citywide"} /></div></Card>}
          </aside>
        </section>

        <section className="grid gap-5 lg:grid-cols-[1.25fr_.75fr]">
          <Card className="border-[#dfe5dd] p-5"><div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#55705c]">Reporting rhythm</p><h2 className="mt-2 text-xl font-bold tracking-[-0.02em] text-[#14231a]">Activity in scope</h2></div><span className="rounded-md bg-[#eef3ed] px-2.5 py-1 text-xs font-semibold text-[#2a4a33]">{data?.summary.total ?? 0} verified</span></div><p className="mt-2 text-sm text-zinc-500">Daily reporting volume across the selected window.</p><div className="mt-5 h-56"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} margin={{ top: 8, right: 4, left: -22, bottom: 0 }}><defs><linearGradient id="insightFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2a4a33" stopOpacity={0.26} /><stop offset="100%" stopColor="#2a4a33" stopOpacity={0.02} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="#e4e9e2" /><XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" /><YAxis allowDecimals={false} tick={{ fontSize: 10 }} /><Tooltip /><Area type="monotone" dataKey="count" stroke="#2a4a33" strokeWidth={2.5} fill="url(#insightFill)" /></AreaChart></ResponsiveContainer></div></Card>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1"><Card className="border-[#dfe5dd] p-5"><div className="flex items-start justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#55705c]">Category mix</p><h2 className="mt-2 text-xl font-bold tracking-[-0.02em] text-[#14231a]">What is being reported</h2></div><span className="text-xs text-zinc-500">{data?.signal_count ?? 0} signals</span></div><div className="mt-4 h-40"><ResponsiveContainer width="100%" height="100%"><BarChart data={categories.map((item) => ({ ...item, label: categoryLabel(item.name) }))} layout="vertical" margin={{ top: 0, right: 18, left: 0, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e4e9e2" /><XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} /><YAxis type="category" dataKey="label" width={118} tick={{ fontSize: 10 }} /><Tooltip /><Bar dataKey="count" radius={[0, 5, 5, 0]}>{categories.map((item, index) => <Cell key={item.name} fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]} />)}</Bar></BarChart></ResponsiveContainer></div></Card><Card className="border-[#dfe5dd] p-5"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#55705c]">Severity mix</p><div className="mt-4 space-y-3">{(data?.summary.by_severity ?? []).map((item) => { const total = data?.summary.total || 1; return <div key={item.severity}><div className="mb-1 flex justify-between text-xs"><span className="font-semibold capitalize text-zinc-700">{item.severity}</span><span className="tabular-nums text-zinc-500">{item.count} · {Math.round((item.count / total) * 100)}%</span></div><div className="h-2 overflow-hidden rounded-full bg-zinc-100"><div className="h-full rounded-full transition-all duration-300" style={{ width: `${(item.count / total) * 100}%`, backgroundColor: SEVERITY_COLORS[item.severity] ?? "#71717a" }} /></div></div>; })}</div></Card></div>
        </section>

        <section><div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#55705c]">Ranked evidence</p><h2 className="mt-2 text-2xl font-bold tracking-[-0.03em] text-[#14231a]">Signals worth understanding</h2></div><p className="text-xs text-zinc-500">Showing top {Math.min(3, narratives.length)} of {data?.signal_count ?? 0}</p></div>{narratives.length ? <div className="grid gap-4 lg:grid-cols-2">{narratives.slice(1).map((signal) => <SignalCard key={signal.id} signal={signal} filters={filters} />)}</div> : <Card className="border-[#dfe5dd] p-6 text-sm text-zinc-500">No recurring signal matches the current scope.</Card>}</section>
      </>}
    </div>
  );
}

export default function AnalyticsPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-[1500px] space-y-5"><Skeleton className="h-24" /><div className="grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_360px]"><Skeleton className="h-[600px]" /><Skeleton className="h-[600px]" /></div></div>}>
      <AnalyticsPageContent />
    </Suspense>
  );
}
