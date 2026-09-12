"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { AdminIncidentPage, AnalyticsSummary, Hotspot } from "@/lib/types";
import { DEFAULT_FILTERS, signalHref } from "@/lib/insights";
import { incidentHref } from "@/lib/incident-scope";
import { categoryLabel } from "@/lib/taxonomy";
import { Card } from "@/components/ui/card";
import { FeedbackPanel } from "@/components/ui/feedback-panel";
import { PageHeader } from "@/components/ui/page-header";
import {
  Area,
  AreaChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const FONT = { fontFamily: "Verdana, Geneva, sans-serif" } as const;

const STATUS_META: Record<string, { label: string; color: string }> = {
  needs_review: { label: "Needs review", color: "#d97706" },
  processing: { label: "Processing", color: "#ca8a04" },
  verified: { label: "Verified", color: "#2563eb" },
  escalated: { label: "Escalated", color: "#7c3aed" },
  resolved: { label: "Resolved", color: "#15803d" },
  awaiting_verification: { label: "Awaiting verification", color: "#b45309" },
  community_confirmed: { label: "Community confirmed", color: "#047857" },
  needs_follow_up: { label: "Needs follow-up", color: "#be123c" },
  rejected: { label: "Rejected", color: "#71717a" },
  closed: { label: "Closed", color: "#52525b" },
};

const SEV_META: Record<string, { label: string; color: string }> = {
  critical: { label: "Critical", color: "#dc2626" },
  high: { label: "High", color: "#ea580c" },
  medium: { label: "Medium", color: "#ca8a04" },
  low: { label: "Low", color: "#16a34a" },
};

const DONUT_COLORS = ["#14231a", "#c2410c", "#1d4ed8", "#7e22ce", "#0f766e", "#b45309", "#be123c"];

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.max(0, Math.floor(ms / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function count(list: { count: number }[] | undefined): number {
  return (list ?? []).reduce((n, x) => n + x.count, 0);
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-zinc-200/70 ${className}`} />;
}

function Kpi({
  label,
  value,
  sub,
  definition,
  spark,
  accent,
  href,
}: {
  label: string;
  value: string | number;
  sub: string;
  definition: string;
  spark: { date: string; count: number }[];
  accent: string;
  href: string;
}) {
  // Always draw the sparkline — a single day renders flat with a tooltip note.
  const single = spark.length < 2;
  return (
    <Link
      href={href}
      className="group relative block overflow-hidden rounded-lg border border-zinc-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#2a4a33] focus:ring-offset-2"
      aria-label={`${label}: ${value}. ${definition}. Open matching incidents.`}
    >
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: accent }} />
      <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
      <div className="mt-1 flex items-end justify-between gap-3">
        <p className="text-3xl font-bold tabular-nums">{value}</p>
        <div
          className="flex h-10 w-28 shrink-0 items-center"
          title={single ? "Needs more data — only one reporting day so far" : "Reports over recent days"}
        >
          {spark.length === 0 ? (
            <p className="w-full text-right text-[11px] text-zinc-400">no data yet</p>
          ) : single ? (
            <span className="block h-[3px] w-full rounded-full" style={{ background: accent }} />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={spark} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                <Area type="monotone" dataKey="count" stroke={accent} fill={accent} fillOpacity={0.18} strokeWidth={2} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
      <p className="mt-1 text-xs text-zinc-500">{sub}</p>
      <p className="mt-3 border-t border-zinc-100 pt-2 text-[11px] leading-5 text-zinc-500 group-hover:text-zinc-700">{definition}</p>
      <span className="mt-2 inline-flex text-xs font-semibold text-[#285e4a]">Open matching incidents →</span>
    </Link>
  );
}

type ActionCounts = AnalyticsSummary["action_counts"];

const EMPTY_ACTION_COUNTS: ActionCounts = {
  overdue: 0,
  breaching: 0,
  needs_review: 0,
  escalated: 0,
  needs_follow_up: 0,
};

function ActionPanel({ action }: { action: ActionCounts }) {
  const hasAction = action.overdue + action.breaching + action.needs_review + action.escalated + action.needs_follow_up > 0;
  const items = [
    {
      label: "Overdue",
      value: action.overdue,
      detail: "Past the response budget",
      href: incidentHref({ window_days: 30, state: "needs_attention", sla: "overdue", sort: "action" }),
      tone: "border-red-200 bg-red-50 text-red-900",
    },
    {
      label: "Needs review",
      value: action.needs_review,
      detail: "Waiting for staff triage",
      href: incidentHref({ window_days: 30, status: "needs_review", sort: "action" }),
      tone: "border-amber-200 bg-amber-50 text-amber-950",
    },
    {
      label: "Escalated",
      value: action.escalated,
      detail: "Requires authority attention",
      href: incidentHref({ window_days: 30, status: "escalated", sort: "action" }),
      tone: "border-purple-200 bg-purple-50 text-purple-950",
    },
  ];

  return (
    <section aria-labelledby="needs-action-heading" className="rounded-xl border border-[#b8ccb9] bg-[#f1f6ef] p-5 shadow-[0_8px_25px_rgba(20,35,26,0.06)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#55705c]">Operator priority</p>
          <h2 id="needs-action-heading" className="mt-1 text-xl font-bold tracking-[-0.02em] text-[#14231a]">Needs action</h2>
          <p className="mt-1 max-w-[62ch] text-sm leading-6 text-zinc-600">Open work in the last 30 calendar days, ordered for the next response.</p>
        </div>
        <Link href={incidentHref({ window_days: 30, state: "needs_attention", sort: "action" })} className="rounded-md bg-[#14231a] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#2a4a33] focus:outline-none focus:ring-2 focus:ring-[#2a4a33] focus:ring-offset-2">Open full queue →</Link>
      </div>
      {!hasAction ? (
        <p className="mt-4 rounded-lg border border-[#cbdacb] bg-white/70 px-4 py-3 text-sm text-[#285e4a]">No incident needs immediate action in this window.</p>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {items.map((item) => (
            <Link key={item.label} href={item.href} className={`rounded-lg border p-4 transition hover:-translate-y-0.5 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-[#2a4a33] focus:ring-offset-2 ${item.tone}`}>
              <div className="flex items-start justify-between gap-3"><span className="text-sm font-semibold">{item.label}</span><span className="text-3xl font-bold tabular-nums">{item.value}</span></div>
              <p className="mt-2 text-xs opacity-80">{item.detail}</p>
              <span className="mt-3 inline-flex text-xs font-semibold underline-offset-2 hover:underline">Open scoped queue →</span>
            </Link>
          ))}
        </div>
      )}
      {(action.breaching > 0 || action.needs_follow_up > 0) && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-[#cbdacb] pt-3 text-xs text-zinc-600">
          {action.breaching > 0 && <Link href={incidentHref({ window_days: 30, state: "needs_attention", sla: "breaching", sort: "action" })} className="font-semibold text-amber-800 underline-offset-2 hover:underline">{action.breaching} breaching SLA</Link>}
          {action.needs_follow_up > 0 && <Link href={incidentHref({ window_days: 30, status: "needs_follow_up", sort: "action" })} className="font-semibold text-rose-800 underline-offset-2 hover:underline">{action.needs_follow_up} need follow-up</Link>}
        </div>
      )}
    </section>
  );
}

function SignalRow({ signal }: { signal: Hotspot }) {
  return (
    <li className="grid gap-3 border-t border-zinc-100 py-3 first:border-t-0 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_4.5rem_7rem_8rem_7.25rem] lg:items-center">
      <div className="min-w-0"><p className="truncate text-sm font-semibold text-[#14231a]">{categoryLabel(signal.category)}</p><p className="mt-0.5 text-xs text-zinc-500">Recurring signal</p></div>
      <div className="min-w-0"><p className="text-sm font-semibold text-[#285e4a]">{signal.persistence_score} score</p><p className="text-xs capitalize text-zinc-500">{signal.trend} trend</p></div>
      <div className="min-w-0"><p className="text-[10px] uppercase tracking-wide text-zinc-400 lg:hidden">Reports</p><p className="text-sm font-semibold tabular-nums text-zinc-800">{signal.report_count}</p></div>
      <div className="min-w-0"><p className="text-[10px] uppercase tracking-wide text-zinc-400 lg:hidden">Contributors</p><p className="text-sm font-semibold tabular-nums text-zinc-800">{signal.unique_contributors}</p></div>
      <div className="min-w-0"><p className="text-[10px] uppercase tracking-wide text-zinc-400 lg:hidden">Last observed</p><p className="text-xs text-zinc-600">{new Date(signal.last_observed).toLocaleDateString([], { month: "short", day: "numeric" })}</p></div>
      <Link href={signalHref(signal.id, { ...DEFAULT_FILTERS, window_days: 30 })} className="min-w-0 whitespace-nowrap text-xs font-semibold text-[#285e4a] underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-[#2a4a33]">Open evidence →</Link>
    </li>
  );
}

export default function DashboardPage() {
  const [activeCat, setActiveCat] = useState<number | null>(null);
  const summary = useQuery({
    queryKey: ["admin-summary"],
    queryFn: () => apiFetch<AnalyticsSummary>("/admin/analytics/summary?window_days=30"),
  });
  const recent = useQuery({
    queryKey: ["admin-recent"],
    queryFn: () => apiFetch<AdminIncidentPage>("/admin/incidents?window_days=30&page_size=6"),
  });
  const hotspots = useQuery({
    queryKey: ["admin-hotspots"],
    queryFn: () => apiFetch<Hotspot[]>("/admin/analytics/hotspots?limit=6&window_days=30"),
    retry: false,
  });

  if (summary.isLoading) {
    return (
      <div className="mx-auto max-w-[1500px] space-y-6 pb-10" style={FONT}>
        <div>
          <Skeleton className="h-7 w-56" />
          <Skeleton className="mt-2 h-4 w-80" />
        </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <Skeleton className="h-72 lg:col-span-3" />
          <Skeleton className="h-72 lg:col-span-2" />
        </div>
      </div>
    );
  }

  if (summary.error) {
    return (
      <FeedbackPanel
        variant="error"
        title="Dashboard failed to load"
        description={(summary.error as Error).message}
        action={<button onClick={() => summary.refetch()} className="rounded-md bg-[#14231a] px-3 py-1.5 text-sm font-medium text-white transition hover:bg-[#2a4a33] focus:outline-none focus:ring-2 focus:ring-[#2a4a33] focus:ring-offset-2">Retry</button>}
      />
    );
  }

  const data = summary.data;
  const total = data?.total ?? count(data?.by_status);
  const byStatus = data?.by_status ?? [];
  const byCat = data?.by_category ?? [];
  const bySev = data?.by_severity ?? [];
  const byDay = [...(data?.by_day ?? [])].sort((a, b) => (a.date < b.date ? -1 : 1));
  const sparkTotal = byDay.map((d) => ({ date: d.date, count: d.count }));
  const sparkOpen = byDay.map((d) => ({ date: d.date, count: d.open ?? 0 }));
  const sparkResolved = byDay.map((d) => ({ date: d.date, count: d.resolved ?? 0 }));
  const sparkCritical = byDay.map((d) => ({ date: d.date, count: d.critical ?? 0 }));
  const statusCount = (s: string) => byStatus.find((x) => x.status === s)?.count ?? 0;
  const sevCount = (s: string) => bySev.find((x) => x.severity === s)?.count ?? 0;
  const open = statusCount("processing") + statusCount("needs_review") + statusCount("verified") + statusCount("escalated") + statusCount("awaiting_verification") + statusCount("needs_follow_up");
  const resolved = statusCount("resolved") + statusCount("community_confirmed");
  const critical = sevCount("critical");
  const maxDay = Math.max(1, ...byDay.map((d) => d.count));
  const last7 = byDay.slice(-7);
  const weekTotal = count(last7);

  const incidents = recent.data?.items ?? [];
  const feed = incidents.slice(0, 6);
  const queue = incidents.filter((i) => i.status === "needs_review" || i.status === "escalated").slice(0, 5);

  const todayCount = byDay.length > 0 ? byDay[byDay.length - 1].count : 0;
  const prevCount = byDay.length > 1 ? byDay[byDay.length - 2].count : null;
  const delta =
    prevCount === null
      ? "first day of data"
      : todayCount === prevCount
        ? "same as yesterday"
        : `${todayCount > prevCount ? "+" : ""}${todayCount - prevCount} vs yesterday`;
  const needsReview = statusCount("needs_review");
  const escalated = statusCount("escalated");
  const attentionSub =
    needsReview > 0
      ? `${needsReview} awaiting review`
      : escalated > 0
        ? `${escalated} escalated — needs action`
        : "queue is clear";
  const activeEntry = activeCat !== null ? byCat[activeCat] : undefined;

  return (
    <div className="mx-auto max-w-[1500px] space-y-6 pb-10" style={FONT}>
      <PageHeader
        eyebrow="Authority operations"
        title="Command overview"
        description={`${total} incidents in the last 30 calendar days · ${weekTotal} reports across active reporting days.`}
        meta={<span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-800"><span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-600" /></span>Live from operations API</span>}
      />

      <ActionPanel action={data?.action_counts ?? EMPTY_ACTION_COUNTS} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Total incidents" value={total} sub={`${byCat.length} categories reporting · ${delta}`} definition="Every incident created in this 30-day window." href={incidentHref({ window_days: 30 })} spark={sparkTotal} accent="#14231a" />
        <Kpi label="Needs attention" value={open} sub={attentionSub} definition="Open workflow statuses requiring staff handling." href={incidentHref({ window_days: 30, state: "needs_attention", sort: "action" })} spark={sparkOpen} accent="#d97706" />
        <Kpi label="Resolved" value={resolved} sub={total ? `${Math.round((resolved / Math.max(1, total)) * 100)}% clearance rate` : "No resolutions yet"} definition="Resolved or community-confirmed incidents in this window." href={incidentHref({ window_days: 30, state: "resolved" })} spark={sparkResolved} accent="#15803d" />
        <Kpi label="Critical severity" value={critical} sub={`${sevCount("high")} high-severity alongside · ${delta}`} definition="Incidents marked critical in this window." href={incidentHref({ window_days: 30, severity: "critical", sort: "action" })} spark={sparkCritical} accent="#dc2626" />
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-500">Recurring environmental signals</h2>
            <p className="mt-1 text-sm text-zinc-500">Verified observations grouped by place, category, and time.</p>
          </div>
          <Link href="/analytics" className="text-xs font-semibold text-[#2a4a33] hover:underline">Open analytics →</Link>
        </div>
        {hotspots.isLoading ? (
          <div className="mt-4 grid gap-2 sm:grid-cols-3"><Skeleton className="h-20" /><Skeleton className="h-20" /><Skeleton className="h-20" /></div>
        ) : hotspots.error ? (
          <p className="mt-4 rounded-lg bg-zinc-50 p-3 text-sm text-zinc-500">Signals are unavailable right now.</p>
        ) : (hotspots.data ?? []).length === 0 ? (
          <p className="mt-4 rounded-lg bg-zinc-50 p-3 text-sm text-zinc-500">No recurring signals yet — verified reports will surface here.</p>
        ) : (
          <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50/70 px-3">
            <div className="hidden gap-3 border-b border-zinc-200 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400 lg:grid lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_4.5rem_7rem_8rem_7.25rem] lg:items-center">
              <span className="min-w-0 whitespace-nowrap">Category</span><span className="min-w-0 whitespace-nowrap">Priority</span><span className="min-w-0 whitespace-nowrap">Reports</span><span className="min-w-0 whitespace-nowrap">Contributors</span><span className="min-w-0 whitespace-nowrap">Last observed</span><span className="min-w-0 whitespace-nowrap">Action</span>
            </div>
            <ul aria-label="Recurring environmental signals">{(hotspots.data ?? []).map((spot) => <SignalRow key={spot.id} signal={spot} />)}</ul>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="p-5 lg:col-span-3">
          <div className="flex items-baseline justify-between">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-500">Reporting trend</h2>
              <p className="mt-0.5 text-lg font-bold text-[#14231a]">{weekTotal} reports <span className="text-sm font-normal text-zinc-500">in recent days</span></p>
            </div>
            <span className="rounded-full bg-[#14231a] px-2 py-0.5 text-[11px] font-semibold text-white" title="Busiest reporting day">peak {maxDay}/day</span>
          </div>
          <div className="mt-3 h-52">
            {byDay.length === 0 ? (
              <div className="flex h-full items-center justify-center rounded-lg bg-zinc-50 text-sm text-zinc-500">No trend data yet — new reports will appear here.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={byDay} margin={{ top: 4, right: 4, bottom: 0, left: -8 }}>
                  <defs>
                    <linearGradient id="dashTrend" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2a4a33" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#2a4a33" stopOpacity={0.03} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(d: string) => {
                      const t = new Date(`${d}T00:00:00`);
                      return isNaN(t.getTime()) ? d : t.toLocaleDateString([], { month: "short", day: "numeric" });
                    }}
                  />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(v) => [`${v} reports`, "Reports"]}
                    labelFormatter={(l) => {
                      const t = new Date(`${l}T00:00:00`);
                      return isNaN(t.getTime()) ? `Date: ${l}` : t.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
                    }}
                  />
                  <Area type="monotone" dataKey="count" stroke="#14231a" fill="url(#dashTrend)" strokeWidth={2.5} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {byDay.slice(-10).map((d) => (
              <span key={d.date} className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] tabular-nums text-zinc-600" title={`${d.count} reports`}>
                {d.date.slice(5)} · {d.count}
              </span>
            ))}
          </div>
        </Card>

        <Card className="p-5 lg:col-span-2">
          <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-500">By category</h2>
          {byCat.length === 0 ? (
            <div className="mt-3 flex h-48 items-center justify-center rounded-lg bg-zinc-50 text-sm text-zinc-500">No categories yet.</div>
          ) : (
            <div className="mt-1 flex items-center gap-4">
              <div className="relative h-44 w-44 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={byCat}
                      dataKey="count"
                      nameKey="name"
                      innerRadius={52}
                      outerRadius={80}
                      paddingAngle={2}
                      isAnimationActive={false}
                      onMouseEnter={(_, i) => setActiveCat(i)}
                      onMouseLeave={() => setActiveCat(null)}
                    >
                      {byCat.map((_, i) => (
                        <Cell
                          key={i}
                          fill={DONUT_COLORS[i % DONUT_COLORS.length]}
                          opacity={activeCat === null || activeCat === i ? 1 : 0.35}
                        />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  {activeEntry ? (
                    <>
                      <span className="text-2xl font-bold tabular-nums capitalize text-[#14231a]">{activeEntry.count}</span>
                      <span className="max-w-24 truncate text-[11px] text-zinc-500">{categoryLabel(activeEntry.name)}</span>
                    </>
                  ) : (
                    <>
                      <span className="text-2xl font-bold tabular-nums text-[#14231a]">{count(byCat)}</span>
                      <span className="text-[11px] text-zinc-500">reports</span>
                    </>
                  )}
                </div>
              </div>
              <ul className="min-w-0 flex-1 space-y-1.5 text-sm">
                {byCat.slice(0, 6).map((c, i) => {
                  const pct = total ? Math.round((c.count / total) * 100) : 0;
                  return (
                    <li
                      key={c.name}
                      className="flex items-center justify-between gap-2"
                      title={`${c.count} reports · ${pct}% of all incidents`}
                      onMouseEnter={() => setActiveCat(i)}
                      onMouseLeave={() => setActiveCat(null)}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                        <span className="min-w-0 truncate">{categoryLabel(c.name)}</span>
                      </span>
                      <span className="whitespace-nowrap font-bold tabular-nums">{c.count} <span className="font-normal text-zinc-400">· {pct}%</span></span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <div className="mt-4 border-t border-zinc-100 pt-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">By severity</h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {bySev.length === 0 && <span className="text-xs text-zinc-500">No severity data.</span>}
              {bySev.map((s) => (
                <span
                  key={s.severity}
                  className="rounded-full px-2.5 py-1 text-xs font-semibold"
                  style={{ background: `${SEV_META[s.severity]?.color ?? "#52525b"}14`, color: SEV_META[s.severity]?.color ?? "#52525b" }}
                >
                  {SEV_META[s.severity]?.label ?? s.severity} · {s.count}
                </span>
              ))}
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-500">Status breakdown</h2>
            <Link href={incidentHref({ window_days: 30 })} className="text-xs font-semibold text-[#2a4a33] hover:underline">Open all</Link>
          </div>
          {byStatus.length === 0 ? (
            <div className="mt-3 flex h-40 items-center justify-center rounded-lg bg-zinc-50 text-sm text-zinc-500">No incidents yet — the queue is clear.</div>
          ) : (
            <ul className="mt-3 space-y-3">
              {byStatus.map((s) => {
                const meta = STATUS_META[s.status] ?? { label: s.status, color: "#52525b" };
                const pct = total ? Math.round((s.count / total) * 100) : 0;
                return (
                  <li key={s.status}>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="font-medium">{meta.label}</span>
                      <span className="text-zinc-500"><b className="text-zinc-900 tabular-nums">{s.count}</b> · {pct}%</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-100">
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: meta.color }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="p-5 lg:col-span-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-500">Latest activity</h2>
            <Link href={incidentHref({ window_days: 30 })} className="text-xs font-semibold text-[#2a4a33] hover:underline">View all incidents</Link>
          </div>
          {recent.isLoading ? (
            <div className="mt-3 space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
          ) : feed.length === 0 ? (
            <div className="mt-3 flex h-40 items-center justify-center rounded-lg bg-zinc-50 text-sm text-zinc-500">
              {recent.error ? "Activity feed failed to load." : "No incidents reported yet."}
            </div>
          ) : (
            <ul className="mt-3 divide-y divide-zinc-100">
              {feed.map((i) => {
                const sm = STATUS_META[i.status] ?? { label: i.status, color: "#52525b" };
                const vm = SEV_META[i.severity] ?? { label: i.severity, color: "#52525b" };
                return (
                  <li key={i.id}>
                    <Link href={`/incidents/${i.id}`} className="flex items-center gap-3 py-2.5 transition hover:bg-zinc-50">
                      <span className="h-9 w-1 shrink-0 rounded-full" style={{ background: vm.color }} title={`${vm.label} severity`} />
                      {i.status === "escalated" && (
                        <span className="relative flex h-2 w-2 shrink-0" title="Needs action">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-purple-500 opacity-60" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-purple-600" />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{i.title}</p>
                        <p className="truncate text-xs text-zinc-500">
                          {(i.address ?? `${i.lat.toFixed(2)}, ${i.lng.toFixed(2)}`)} ·{" "}
                          <span title={new Date(i.created_at).toLocaleString()}>{timeAgo(i.created_at)}</span>
                        </p>
                      </div>
                      <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: `${sm.color}14`, color: sm.color }}>
                        {sm.label}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          {queue.length > 0 && (
            <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <b>{queue.length}</b> item{queue.length === 1 ? "" : "s"} needing review or escalated — oldest first in <Link href={incidentHref({ window_days: 30, state: "needs_attention", sort: "action" })} className="font-bold underline">Incidents</Link>.
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
