"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
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
import { Heatmap, type MapBounds } from "@/components/map";
import { apiFetch, buildQuery } from "@/lib/api";
import { categoryLabel } from "@/lib/taxonomy";
import type { Hotspot, Incident, InsightsSnapshot } from "@/lib/types";

const FONT = { fontFamily: "Verdana, Geneva, sans-serif" } as const;
const CATEGORY_COLORS = ["#2a4a33", "#c2410c", "#1d4ed8", "#7e22ce", "#0f766e", "#b45309"];
const SEVERITY_COLORS: Record<string, string> = {
  critical: "#dc2626",
  high: "#ea580c",
  medium: "#ca8a04",
  low: "#16a34a",
};

type WindowDays = 7 | 30 | 90;

function shortDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function dateTime(value: string | null | undefined): string {
  if (!value) return "Unknown time";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function scoreLabel(score: number): string {
  if (score >= 80) return "Strong recurring signal";
  if (score >= 60) return "Established signal";
  return "Emerging signal";
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-zinc-200/70 ${className}`} />;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-1 font-bold capitalize tabular-nums text-[#14231a]">{value}</p>
    </div>
  );
}

function NarrativeCard({
  narrative,
  featured = false,
  onOpen,
}: {
  narrative: Hotspot;
  featured?: boolean;
  onOpen: () => void;
}) {
  return (
    <article
      className={`relative overflow-hidden rounded-2xl border p-5 transition-shadow hover:shadow-md ${
        featured ? "border-[#b9cdbb] bg-[#f1f6ef]" : "border-zinc-200 bg-white"
      }`}
    >
      <span
        className="absolute inset-y-0 left-0 w-1"
        style={{ backgroundColor: narrative.persistence_score >= 80 ? "#2a4a33" : "#c8a34b" }}
      />
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
            {featured ? "Priority signal" : "Recurring signal"}
          </p>
          <h2 className="mt-2 text-xl font-bold tracking-tight text-[#14231a]">
            {categoryLabel(narrative.category)}
          </h2>
          <p className="mt-1 text-sm font-medium text-[#55705c]">{scoreLabel(narrative.persistence_score)}</p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-bold tabular-nums text-[#14231a]">{narrative.persistence_score}</p>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">signal score</p>
        </div>
      </div>
      <p className="mt-5 max-w-2xl text-sm leading-6 text-zinc-700">{narrative.explanation}</p>
      <div className="mt-5 grid grid-cols-2 gap-3 border-y border-black/10 py-4 text-sm sm:grid-cols-4">
        <Metric label="Reports" value={narrative.report_count} />
        <Metric label="Contributors" value={narrative.unique_contributors} />
        <Metric label="Mean spread" value={`${narrative.mean_distance_km.toFixed(2)} km`} />
        <Metric label="Trend" value={narrative.trend} />
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-xs text-zinc-500">Last observed {dateTime(narrative.last_observed)}</p>
        <button
          type="button"
          onClick={onOpen}
          className="rounded-md bg-[#14231a] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#285e4a] focus:outline-none focus:ring-2 focus:ring-[#2a4a33] focus:ring-offset-2 active:translate-y-px"
        >
          Inspect evidence
        </button>
      </div>
    </article>
  );
}

function EvidenceDrawer({ narrative, onClose }: { narrative: Hotspot; onClose: () => void }) {
  const reports = useQuery({
    queryKey: ["insight-evidence", narrative.report_ids],
    queryFn: () =>
      Promise.all(
        narrative.report_ids.slice(0, 20).map((id) => apiFetch<Incident>(`/admin/incidents/${id}`)),
      ),
  });

  return (
    <>
      <button
        type="button"
        aria-label="Close evidence"
        onClick={onClose}
        className="fixed inset-0 z-[80] cursor-default bg-[#14231a]/25 backdrop-blur-[1px]"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="evidence-title"
        className="fixed inset-y-0 right-0 z-[81] flex w-full max-w-xl flex-col border-l border-zinc-200 bg-[#faf7f0] shadow-2xl"
      >
        <div className="flex items-start justify-between border-b border-zinc-200 bg-white px-6 py-5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Evidence view</p>
            <h2 id="evidence-title" className="mt-1 text-xl font-bold tracking-tight text-[#14231a]">
              {categoryLabel(narrative.category)} signal
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close evidence"
            className="rounded-md border border-zinc-200 px-2.5 py-1.5 text-sm text-zinc-600 transition hover:bg-zinc-100 focus:outline-none focus:ring-2 focus:ring-[#2a4a33]"
          >
            Close
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Reports" value={narrative.report_count} />
            <Metric label="Contributors" value={narrative.unique_contributors} />
            <Metric label="Score" value={narrative.persistence_score} />
            <Metric label="Trend" value={narrative.trend} />
          </div>
          <div className="mt-5 rounded-xl border border-[#cbdacb] bg-[#f1f6ef] p-4">
            <p className="text-sm leading-6 text-zinc-700">{narrative.explanation}</p>
            <p className="mt-3 text-xs text-zinc-500">
              Centroid {narrative.centroid.lat.toFixed(5)}, {narrative.centroid.lng.toFixed(5)} · mean spread {narrative.mean_distance_km.toFixed(2)} km
            </p>
          </div>
          <div className="mt-7 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-[#14231a]">Contributing reports</h3>
              <p className="mt-1 text-xs text-zinc-500">Verified, high-confidence observations behind this signal.</p>
            </div>
            <span className="text-xs font-semibold text-zinc-500">{narrative.report_ids.length} reports</span>
          </div>
          {reports.isLoading ? (
            <div className="mt-4 space-y-3"><Skeleton className="h-20" /><Skeleton className="h-20" /></div>
          ) : reports.error ? (
            <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">Evidence could not be loaded. The signal metrics are still available.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {(reports.data ?? []).map((report) => {
                const reportCategory = String(report.ai_analysis?.category ?? narrative.category);
                const reason = String(report.ai_analysis?.reason ?? "No analysis reason recorded.");
                return (
                  <Link
                    key={report.id}
                    href={`/incidents/${report.id}`}
                    className="block rounded-xl border border-zinc-200 bg-white p-4 transition hover:border-[#9fba9f] hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-[#2a4a33]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-[#14231a]">{report.title}</p>
                        <p className="mt-1 text-xs capitalize text-zinc-500">{categoryLabel(reportCategory)} · {report.severity} · {dateTime(report.created_at)}</p>
                      </div>
                      <span className="text-xs font-semibold text-[#2a4a33]">Open →</span>
                    </div>
                    <p className="mt-3 text-xs leading-5 text-zinc-600">{reason}</p>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

export default function AnalyticsPage() {
  const [windowDays, setWindowDays] = useState<WindowDays>(30);
  const [radiusKm, setRadiusKm] = useState("0.75");
  const [category, setCategory] = useState("");
  const [severity, setSeverity] = useState("");
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const [selected, setSelected] = useState<Hotspot | null>(null);

  const query = useMemo(
    () =>
      buildQuery({
        window_days: String(windowDays),
        radius_km: radiusKm,
        category: category || undefined,
        severity: severity || undefined,
        min_lat: bounds ? String(bounds.min_lat) : undefined,
        min_lng: bounds ? String(bounds.min_lng) : undefined,
        max_lat: bounds ? String(bounds.max_lat) : undefined,
        max_lng: bounds ? String(bounds.max_lng) : undefined,
      }),
    [bounds, category, radiusKm, severity, windowDays],
  );
  const insights = useQuery({
    queryKey: ["admin-insights", query],
    queryFn: () => apiFetch<InsightsSnapshot>(`/admin/insights${query}`),
  });
  const data = insights.data;
  const narratives = data?.narratives ?? [];
  const lead = narratives[0];
  const chartData = useMemo(
    () => (data?.summary.by_day ?? []).map((day) => ({ ...day, label: shortDate(day.date) })),
    [data?.summary.by_day],
  );
  const categories = data?.summary.by_category ?? [];
  const onBoundsChange = useCallback((next: MapBounds) => {
    setBounds((previous) => {
      if (previous && JSON.stringify(previous) === JSON.stringify(next)) return previous;
      return next;
    });
  }, []);

  return (
    <div className="mx-auto max-w-[1480px] space-y-6" style={FONT}>
      <header className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#55705c]">Authority intelligence</p>
          <h1 className="mt-2 text-4xl font-bold tracking-[-0.04em] text-[#14231a]">Insights</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">See what is repeating, where signals are concentrating, and which environmental patterns deserve attention.</p>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-xs text-zinc-500">{data ? `Updated ${dateTime(data.generated_at)}` : "Awaiting live data"}</p>
          <button type="button" onClick={() => insights.refetch()} disabled={insights.isFetching} className="inline-flex items-center gap-2 rounded-md bg-[#14231a] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#285e4a] focus:outline-none focus:ring-2 focus:ring-[#2a4a33] focus:ring-offset-2 disabled:cursor-wait disabled:opacity-60"><span aria-hidden>{insights.isFetching ? "○" : "↻"}</span>{insights.isFetching ? "Refreshing" : "Refresh insights"}</button>
        </div>
      </header>

      <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm lg:p-5" aria-label="Insight scope controls">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div><p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Analysis scope</p><div className="mt-3 flex flex-wrap items-center gap-2">{[7, 30, 90].map((days) => <button key={days} type="button" aria-pressed={windowDays === days} onClick={() => setWindowDays(days as WindowDays)} className={`rounded-md px-3 py-2 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-[#2a4a33] focus:ring-offset-1 ${windowDays === days ? "bg-[#14231a] text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"}`}>{days} days</button>)}</div></div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="text-xs font-semibold text-zinc-600">Signal radius<select value={radiusKm} onChange={(event) => setRadiusKm(event.target.value)} className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-normal text-zinc-800 outline-none transition focus:border-[#2a4a33] focus:ring-2 focus:ring-[#dce8dc]"><option value="0.25">250 m</option><option value="0.5">500 m</option><option value="0.75">750 m</option><option value="1.5">1.5 km</option><option value="3">3 km</option></select></label>
            <label className="text-xs font-semibold text-zinc-600">Category<select value={category} onChange={(event) => setCategory(event.target.value)} className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-normal text-zinc-800 outline-none transition focus:border-[#2a4a33] focus:ring-2 focus:ring-[#dce8dc]"><option value="">All categories</option>{categories.map((item) => <option key={item.name} value={item.name}>{categoryLabel(item.name)}</option>)}</select></label>
            <label className="text-xs font-semibold text-zinc-600">Severity<select value={severity} onChange={(event) => setSeverity(event.target.value)} className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-normal capitalize text-zinc-800 outline-none transition focus:border-[#2a4a33] focus:ring-2 focus:ring-[#dce8dc]"><option value="">All severities</option><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3 text-xs text-zinc-500"><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#2a4a33]" />Verified, high-confidence evidence only</span>{bounds ? <><span className="text-zinc-300">·</span><span>Map scope linked</span><button type="button" onClick={() => setBounds(null)} className="font-semibold text-[#2a4a33] underline-offset-2 hover:underline">Clear map scope</button></> : <><span className="text-zinc-300">·</span><span>Move the map to focus the analysis</span></>}</div>
      </section>

      {insights.isLoading ? <div className="grid gap-5 lg:grid-cols-[1.25fr_.75fr]"><Skeleton className="h-[360px]" /><Skeleton className="h-[360px]" /></div> : insights.error ? <Card className="border-red-200 bg-red-50 p-8 text-center"><p className="text-sm text-red-700">Insights could not load from the operations API.</p><button type="button" onClick={() => insights.refetch()} className="mt-4 rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white">Retry</button></Card> : <>
        <div className="grid gap-5 lg:grid-cols-[1.25fr_.75fr]">
          {lead ? <NarrativeCard narrative={lead} featured onOpen={() => setSelected(lead)} /> : <Card className="flex min-h-[320px] items-center justify-center p-8 text-center"><div><p className="text-lg font-bold text-[#14231a]">No recurring signals in this scope</p><p className="mt-2 max-w-md text-sm leading-6 text-zinc-500">Broaden the time window or map scope. Signals appear after verified, high-confidence observations recur near one another.</p></div></Card>}
          <Card className="overflow-hidden p-5"><div className="flex items-start justify-between gap-4"><div><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Reporting rhythm</p><h2 className="mt-2 text-xl font-bold tracking-tight text-[#14231a]">Activity in scope</h2></div><span className="rounded-full bg-[#eef3ed] px-2.5 py-1 text-xs font-semibold text-[#2a4a33]">{data?.summary.total ?? 0} verified</span></div><p className="mt-2 text-sm text-zinc-500">Verified observations across the selected window.</p><div className="mt-5 h-52"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} margin={{ top: 8, right: 4, left: -22, bottom: 0 }}><defs><linearGradient id="insightFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2a4a33" stopOpacity={0.28} /><stop offset="100%" stopColor="#2a4a33" stopOpacity={0.03} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" /><XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" /><YAxis allowDecimals={false} tick={{ fontSize: 10 }} /><Tooltip /><Area type="monotone" dataKey="count" stroke="#2a4a33" strokeWidth={2} fill="url(#insightFill)" /></AreaChart></ResponsiveContainer></div></Card>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1.15fr_.85fr]"><Card className="overflow-hidden p-0"><div className="flex items-start justify-between gap-3 p-5"><div><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Geographic concentration</p><h2 className="mt-2 text-xl font-bold tracking-tight text-[#14231a]">Signal map</h2></div><span className="text-xs text-zinc-500">{data?.map_points.length ?? 0} reports shown</span></div><Heatmap points={data?.map_points ?? []} onBoundsChange={onBoundsChange} /></Card><div className="space-y-5"><Card className="p-5"><div className="flex items-start justify-between"><div><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Category mix</p><h2 className="mt-2 text-xl font-bold tracking-tight text-[#14231a]">What is being reported</h2></div><span className="text-xs text-zinc-500">{data?.signal_count ?? 0} signals</span></div><div className="mt-5 h-48"><ResponsiveContainer width="100%" height="100%"><BarChart data={categories.map((item) => ({ ...item, label: categoryLabel(item.name) }))} layout="vertical" margin={{ top: 0, right: 20, left: 4, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e4e4e7" /><XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} /><YAxis type="category" dataKey="label" width={118} tick={{ fontSize: 10 }} /><Tooltip /><Bar dataKey="count" radius={[0, 4, 4, 0]}>{categories.map((item, index) => <Cell key={item.name} fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]} />)}</Bar></BarChart></ResponsiveContainer></div></Card><Card className="p-5"><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Severity mix</p><div className="mt-4 space-y-3">{(data?.summary.by_severity ?? []).map((item) => { const total = data?.summary.total || 1; return <div key={item.severity}><div className="mb-1 flex justify-between text-xs"><span className="font-semibold capitalize text-zinc-700">{item.severity}</span><span className="tabular-nums text-zinc-500">{item.count} · {Math.round((item.count / total) * 100)}%</span></div><div className="h-2 overflow-hidden rounded-full bg-zinc-100"><div className="h-full rounded-full" style={{ width: `${(item.count / total) * 100}%`, backgroundColor: SEVERITY_COLORS[item.severity] ?? "#71717a" }} /></div></div>; })}</div></Card></div></div>

        <section><div className="mb-3 flex items-end justify-between gap-4"><div><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Ranked evidence</p><h2 className="mt-2 text-2xl font-bold tracking-tight text-[#14231a]">The next signals to understand</h2></div><p className="text-xs text-zinc-500">Top {Math.min(3, narratives.length)} of {data?.signal_count ?? 0}</p></div>{narratives.length > 1 ? <div className="grid gap-4 md:grid-cols-2">{narratives.slice(1).map((item) => <NarrativeCard key={item.id} narrative={item} onOpen={() => setSelected(item)} />)}</div> : <Card className="p-6 text-sm text-zinc-500">Only one signal matches the current scope.</Card>}</section>
      </>}
      {selected && <EvidenceDrawer narrative={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
