"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiFetch } from "@/lib/api";
import type { AnalyticsSummary, Incident } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Heatmap } from "@/components/map";

export default function AnalyticsPage() {
  const summary = useQuery({
    queryKey: ["admin-summary"],
    queryFn: () => apiFetch<AnalyticsSummary>("/admin/analytics/summary"),
  });
  const incidents = useQuery({
    queryKey: ["admin-incidents-all"],
    queryFn: () => apiFetch<Incident[]>("/admin/incidents"),
  });

  const points = (incidents.data ?? [])
    .filter((i) => typeof i.lat === "number" && typeof i.lng === "number")
    .map((i) => ({ lat: i.lat, lng: i.lng, severity: i.severity }));

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Analytics</h1>
      {summary.isLoading ? (
        <p>Loading charts…</p>
      ) : summary.error ? (
        <p className="text-red-600">{(summary.error as Error).message}</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card>
            <p className="mb-2 text-sm text-zinc-500">By category</p>
            <div style={{ height: 240 }}>
              <ResponsiveContainer>
                <BarChart data={summary.data?.by_category ?? []}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="count" fill="#18181b" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card>
            <p className="mb-2 text-sm text-zinc-500">By day</p>
            <div style={{ height: 240 }}>
              <ResponsiveContainer>
                <LineChart data={summary.data?.by_day ?? []}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Line dataKey="count" stroke="#18181b" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      )}
      <Card>
        <p className="mb-2 text-sm text-zinc-500">Heatmap (circle placeholder)</p>
        <Heatmap points={points} />
      </Card>
    </div>
  );
}
