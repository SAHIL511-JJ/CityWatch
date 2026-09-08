"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { InsightsMap } from "@/components/map";
import { InsightsTimeline } from "@/components/insights-timeline";
import { apiFetch } from "@/lib/api";
import { categoryLabel } from "@/lib/taxonomy";
import { buildReplayDays, insightsQuery, localDayKey, readInsightsFilters } from "@/lib/insights";
import type { Incident, InsightMapPoint, InsightsSnapshot } from "@/lib/types";

const FONT = { fontFamily: "Verdana, Geneva, sans-serif" } as const;
const SEVERITY_COLORS: Record<string, string> = { critical: "#b83b3b", high: "#c45a32", medium: "#b5822b", low: "#278557" };

function dateTime(value: string | null | undefined): string {
  if (!value) return "Unknown time";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{label}</p><p className="mt-1 text-lg font-bold capitalize tabular-nums text-[#14231a]">{value}</p></div>;
}

function EvidenceRow({ incident }: { incident: Incident }) {
  const analysis = incident.ai_analysis ?? {};
  const reason = typeof analysis.reason === "string" ? analysis.reason : "No analysis reason recorded.";
  const confidence = incident.ai_confidence ?? (typeof analysis.confidence === "number" ? analysis.confidence : null);
  return (
    <article className="relative border-l-2 border-[#cbdacb] pl-5 before:absolute before:-left-[7px] before:top-1 before:h-3 before:w-3 before:rounded-full before:border-2 before:border-[#2a4a33] before:bg-[#f1f6ef]">
      <div className="rounded-2xl border border-[#dfe5dd] bg-white p-5 shadow-[0_6px_22px_rgba(20,35,26,0.04)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#55705c]">{dateTime(incident.created_at)}</p><h2 className="mt-1 text-lg font-bold tracking-[-0.02em] text-[#14231a]">{incident.title}</h2></div>
          <span className="rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white" style={{ backgroundColor: SEVERITY_COLORS[incident.severity] ?? "#71717a" }}>{incident.severity}</span>
        </div>
        <p className="mt-3 text-sm leading-6 text-zinc-700">{incident.description}</p>
        <div className="mt-4 grid gap-3 border-y border-zinc-100 py-4 sm:grid-cols-4"><Metric label="Category" value={categoryLabel(String(analysis.category ?? "other_environmental_condition"))} /><Metric label="Confidence" value={confidence === null ? "—" : `${Math.round(confidence * 100)}%`} /><Metric label="Status" value={incident.status.replaceAll("_", " ")} /><Metric label="Location" value={`${incident.lat.toFixed(4)}, ${incident.lng.toFixed(4)}`} /></div>
        <div className="mt-4 rounded-xl bg-[#f7f9f6] p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#55705c]">AI evidence note</p><p className="mt-2 text-sm leading-6 text-zinc-700">{reason}</p></div>
        <Link href={`/incidents/${incident.id}`} className="mt-4 inline-flex text-xs font-semibold text-[#2a4a33] underline-offset-2 hover:underline">Open incident record →</Link>
      </div>
    </article>
  );
}

function InsightEvidencePageContent() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const signalId = decodeURIComponent(params.signalId as string);
  const filters = useMemo(() => readInsightsFilters(searchParams), [searchParams]);
  const query = insightsQuery(filters, 50);
  const insights = useQuery({ queryKey: ["admin-insights-evidence", signalId, query], queryFn: () => apiFetch<InsightsSnapshot>(`/admin/insights${query}`), staleTime: 30000 });
  const signal = insights.data?.narratives.find((item) => item.id === signalId) ?? null;
  const reports = useQuery({
    queryKey: ["insight-evidence-reports", signalId, query],
    enabled: Boolean(signal),
    queryFn: () => Promise.all((signal?.report_ids ?? []).map((id) => apiFetch<Incident>(`/admin/incidents/${id}`))),
  });
  const [timelineDate, setTimelineDate] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const reportIds = useMemo(() => new Set(signal?.report_ids ?? []), [signal?.report_ids]);
  const mapPoints = useMemo(() => (insights.data?.map_points ?? []).filter((point) => reportIds.has(point.id)), [insights.data?.map_points, reportIds]);
  const days = useMemo(() => buildReplayDays(filters.window_days, reports.data ?? []), [filters.window_days, reports.data]);
  const selectedDay = timelineDate ?? days.at(-1)?.date ?? null;
  const visibleReports = useMemo(() => (reports.data ?? []).filter((report) => !selectedDay || (localDayKey(report.created_at) ?? "") <= selectedDay), [reports.data, selectedDay]);
  const visiblePoints = useMemo(() => mapPoints.filter((point) => !selectedDay || !point.created_at || (localDayKey(point.created_at) ?? "") <= selectedDay), [mapPoints, selectedDay]);
  const backHref = `/analytics${insightsQuery(filters)}`;

  return (
    <div className="mx-auto max-w-[1500px] space-y-6 pb-10" style={FONT}>
      <div><button type="button" onClick={() => router.push(backHref)} className="text-xs font-semibold text-[#2a4a33] underline-offset-2 hover:underline">← Back to Insights</button></div>
      {insights.isLoading ? <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,.75fr)]"><div className="h-[650px] animate-pulse rounded-2xl bg-zinc-200/70" /><div className="h-[650px] animate-pulse rounded-2xl bg-zinc-200/70" /></div> : insights.error || !signal ? <Card className="border-red-200 bg-red-50 p-10"><h1 className="text-xl font-bold text-red-900">Evidence page unavailable</h1><p className="mt-2 text-sm leading-6 text-red-700">This signal is no longer present in the selected scope. Return to Insights and choose another signal.</p><Link href={backHref} className="mt-5 inline-flex rounded-lg bg-[#14231a] px-4 py-2.5 text-sm font-semibold text-white">Return to Insights</Link></Card> : <>
        <header className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end"><div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#55705c]">Evidence investigation</p><h1 className="mt-2 text-4xl font-bold tracking-[-0.05em] text-[#14231a]">{categoryLabel(signal.category)} signal</h1><p className="mt-2 max-w-[68ch] text-sm leading-6 text-zinc-600">A transparent view of the verified reports contributing to this recurring environmental pattern.</p></div><div className="text-right"><p className="text-xs text-zinc-500">Read-only evidence view</p><p className="mt-1 text-xs font-semibold text-[#2a4a33]">{filters.window_days}-day scope · {filters.bounds ? "map area" : "citywide"}</p></div></header>
        <section className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,.75fr)]"><Card className="border-[#b8ccb9] bg-[#f1f6ef] p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#55705c]">{signal.trend} pattern</p><h2 className="mt-2 text-3xl font-bold tracking-[-0.04em] text-[#14231a]">{signal.explanation}</h2></div><div className="text-right"><p className="text-5xl font-bold tabular-nums text-[#14231a]">{signal.persistence_score}</p><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">persistence score</p></div></div><div className="mt-7 grid grid-cols-2 gap-4 border-t border-black/10 pt-5 sm:grid-cols-4"><Metric label="Reports" value={signal.report_count} /><Metric label="Contributors" value={signal.unique_contributors} /><Metric label="Mean spread" value={`${signal.mean_distance_km.toFixed(2)} km`} /><Metric label="Last observed" value={new Date(signal.last_observed).toLocaleDateString([], { month: "short", day: "numeric" })} /></div></Card><Card className="border-[#dfe5dd] p-6"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#55705c]">Signal composition</p><div className="mt-5 space-y-3">{Object.entries(signal.severity_summary).map(([severity, count]) => <div key={severity}><div className="mb-1 flex justify-between text-xs"><span className="font-semibold capitalize text-zinc-700">{severity}</span><span className="tabular-nums text-zinc-500">{count} reports</span></div><div className="h-2 overflow-hidden rounded-full bg-zinc-100"><div className="h-full rounded-full" style={{ width: `${(count / signal.report_count) * 100}%`, backgroundColor: SEVERITY_COLORS[severity] ?? "#71717a" }} /></div></div>)}</div><p className="mt-5 border-t border-zinc-100 pt-4 text-xs leading-5 text-zinc-500">Centroid {signal.centroid.lat.toFixed(5)}, {signal.centroid.lng.toFixed(5)} · high-confidence verified evidence only.</p></Card></section>

        <section className="overflow-hidden rounded-2xl border border-[#dfe5dd] bg-white shadow-[0_10px_30px_rgba(20,35,26,0.05)]"><div className="flex flex-wrap items-end justify-between gap-3 p-5"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#55705c]">Signal geography</p><h2 className="mt-2 text-2xl font-bold tracking-[-0.03em] text-[#14231a]">Reports behind this signal</h2></div><p className="text-xs text-zinc-500">{visiblePoints.length} visible of {mapPoints.length} contributing reports</p></div><InsightsMap points={visiblePoints} fitKey={`${signal.id}-${query}`} selectedId={selectedId} onSelect={(point: InsightMapPoint) => setSelectedId(point.id)} height={500} /><InsightsTimeline days={days} value={timelineDate} onChange={setTimelineDate} label="Replay this signal" /></section>

        <section><div className="mb-4 flex items-end justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#55705c]">Evidence ledger</p><h2 className="mt-2 text-2xl font-bold tracking-[-0.03em] text-[#14231a]">Contributing reports</h2></div><p className="text-xs text-zinc-500">{visibleReports.length} shown</p></div>{reports.isLoading ? <div className="space-y-4"><div className="h-48 animate-pulse rounded-2xl bg-zinc-200/70" /><div className="h-48 animate-pulse rounded-2xl bg-zinc-200/70" /></div> : reports.error ? <Card className="border-red-200 bg-red-50 p-6 text-sm text-red-700">The signal metrics loaded, but contributing report details could not be retrieved.</Card> : <div className="space-y-5">{visibleReports.map((report) => <EvidenceRow key={report.id} incident={report} />)}</div>}</section>
      </>}
    </div>
  );
}

export default function InsightEvidencePage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-[1500px] space-y-5"><div className="h-10 w-40 animate-pulse rounded-lg bg-zinc-200/70" /><div className="grid gap-5 lg:grid-cols-2"><div className="h-[360px] animate-pulse rounded-2xl bg-zinc-200/70" /><div className="h-[360px] animate-pulse rounded-2xl bg-zinc-200/70" /></div></div>}>
      <InsightEvidencePageContent />
    </Suspense>
  );
}
