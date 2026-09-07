"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiFetch } from "@/lib/api";
import type { AnalyticsSummary, Incident } from "@/lib/types";
import { categoryLabel } from "@/lib/taxonomy";
import { Card } from "@/components/ui/card";
import { Heatmap } from "@/components/map";

const FONT = { fontFamily: "Verdana, Geneva, sans-serif" } as const;

// Severity palette reused across all charts + map legend
const SEV_COLORS: Record<string, string> = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "#22c55e",
};
const CAT_PALETTE = ["#2a4a33", "#c2410c", "#b45309", "#1d4ed8", "#7e22ce", "#0f766e"];

type RangeKey = 7 | 30;

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shortLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** Points parked near (0,0) are test data — exclude from the map, flag them. */
function isTestPoint(lat: number, lng: number): boolean {
  return Math.abs(lat) < 5 && Math.abs(lng) < 5;
}

export default function AnalyticsPage() {
  const [range, setRange] = useState<RangeKey>(7);
  const [mapQuery, setMapQuery] = useState("");

  const summary = useQuery({
    queryKey: ["admin-summary"],
    queryFn: () => apiFetch<AnalyticsSummary>("/admin/analytics/summary"),
  });
  const incidents = useQuery({
    queryKey: ["admin-incidents-all"],
    queryFn: () => apiFetch<Incident[]>("/admin/incidents"),
  });

  const { points, excluded } = useMemo(() => {
    const all = (incidents.data ?? []).filter(
      (i) => typeof i.lat === "number" && typeof i.lng === "number"
    );
    const kept = all.filter((i) => !isTestPoint(i.lat, i.lng));
    const q = mapQuery.trim().toLowerCase();
    const matched = q
      ? kept.filter(
          (i) =>
            i.title.toLowerCase().includes(q) ||
            (i.description ?? "").toLowerCase().includes(q)
        )
      : kept;
    return {
      points: matched.map((i) => ({
        lat: i.lat,
        lng: i.lng,
        severity: i.severity,
        title: i.title,
        status: i.status,
      })),
      excluded: all.length - kept.length,
    };
  }, [incidents.data, mapQuery]);

  const trend = useMemo(() => {
    const byDate = new Map((summary.data?.by_day ?? []).map((d) => [d.date, d.count]));
    const days: { date: string; label: string; count: number }[] = [];
    const today = new Date();
    for (let i = range - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = dayKey(d);
      days.push({ date: key, label: shortLabel(key), count: byDate.get(key) ?? 0 });
    }
    return days;
  }, [summary.data, range]);

  const peak = useMemo(() => trend.reduce((m, d) => Math.max(m, d.count), 0), [trend]);
  const total = trend.reduce((s, d) => s + d.count, 0);
  const categories = summary.data?.by_category ?? [];
  const displayCategories = categories.map((category) => ({
    ...category,
    label: categoryLabel(category.name),
  }));
  const loading = summary.isLoading || incidents.isLoading;
  const err = (summary.error ?? incidents.error) as Error | null;

  return (
    <div className="space-y-4" style={FONT}>
      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[0, 1].map((i) => (
            <Card key={i} className="animate-pulse">
              <div className="h-4 w-32 rounded bg-zinc-200" />
              <div className="mt-4 h-60 rounded bg-zinc-100" />
            </Card>
          ))}
        </div>
      ) : err ? (
        <Card className="border-red-200 bg-red-50 text-center">
          <p className="text-sm text-red-700">Couldn't load analytics: {err.message}</p>
          <button
            onClick={() => {
              summary.refetch();
              incidents.refetch();
            }}
            className="mt-3 inline-flex items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
          >
            Retry
          </button>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card>
              <p className="mb-1 text-sm font-medium text-zinc-700">By category</p>
              <p className="mb-2 text-xs text-zinc-500">
                {categories.reduce((s, c) => s + c.count, 0)} classified reports
              </p>
              {categories.length === 0 ? (
                <p className="py-10 text-center text-sm text-zinc-500">No category data yet.</p>
              ) : (
                <div style={{ height: 260 }}>
                  <ResponsiveContainer>
                    <BarChart data={displayCategories} margin={{ top: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                        {categories.map((_, i) => (
                          <Cell key={i} fill={CAT_PALETTE[i % CAT_PALETTE.length]} />
                        ))}
                        <LabelList dataKey="count" position="top" style={{ fontSize: 12 }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
            <Card>
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-zinc-700">Reports by day</p>
                <span
                  className="rounded-full bg-[#14231a] px-2 py-0.5 text-[11px] font-semibold text-white"
                  title="Busiest day in range"
                >
                  peak {peak}/day
                </span>
                <span className="ml-auto flex gap-1" role="group" aria-label="Date range">
                  {([7, 30] as RangeKey[]).map((r) => (
                    <button
                      key={r}
                      onClick={() => setRange(r)}
                      aria-pressed={range === r}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                        range === r
                          ? "bg-[#14231a] text-white"
                          : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                      }`}
                    >
                      {r}d
                    </button>
                  ))}
                </span>
              </div>
              <p className="mb-2 text-xs text-zinc-500">{total} reports in the last {range} days</p>
              <div style={{ height: 260 }}>
                <ResponsiveContainer>
                  <AreaChart data={trend} margin={{ top: 8 }}>
                    <defs>
                      <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#2a4a33" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#2a4a33" stopOpacity={0.03} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} interval="preserveStartEnd" />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Area
                      type="monotone"
                      dataKey="count"
                      stroke="#2a4a33"
                      strokeWidth={2}
                      fill="url(#trendFill)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>
          <Card>
            <div className="mb-2 flex flex-wrap items-center gap-3">
              <p className="text-sm font-medium text-zinc-700">
                Incident map{" "}
                <span className="font-normal text-zinc-500">
                  ({points.length} shown{excluded > 0 ? ` · ${excluded} test point${excluded > 1 ? "s" : ""} near (0,0) excluded` : ""})
                </span>
              </p>
              <span className="ml-auto flex flex-wrap items-center gap-2 text-xs text-zinc-500" aria-label="Severity legend">
                {Object.entries(SEV_COLORS).map(([sev, color]) => (
                  <span key={sev} className="inline-flex items-center gap-1 capitalize">
                    <span
                      aria-hidden
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    {sev}
                  </span>
                ))}
              </span>
            </div>
            <div className="mb-2 max-w-sm">
              <label htmlFor="analytics-map-search" className="mb-1 block text-xs font-medium text-zinc-500">
                Filter map
              </label>
              <input
                id="analytics-map-search"
                placeholder="Search map by title or description…"
                value={mapQuery}
                onChange={(e) => setMapQuery(e.target.value)}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#2a4a33]"
              />
            </div>
            {points.length === 0 ? (
              <p className="py-10 text-center text-sm text-zinc-500">
                No mappable incidents{excluded > 0 ? " besides test points" : ""} yet.
              </p>
            ) : (
              <Heatmap points={points} />
            )}
          </Card>
        </>
      )}
    </div>
  );
}
