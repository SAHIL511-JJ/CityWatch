"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { AnalyticsSummary } from "@/lib/types";
import { Card } from "@/components/ui/card";

export default function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-summary"],
    queryFn: () => apiFetch<AnalyticsSummary>("/admin/analytics/summary"),
  });

  if (isLoading) return <p>Loading summary…</p>;
  if (error) return <p className="text-red-600">{(error as Error).message}</p>;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <p className="text-sm text-zinc-500">Total incidents</p>
          <p className="text-2xl font-bold">{data?.total ?? "—"}</p>
        </Card>
        <Card>
          <p className="text-sm text-zinc-500">By status</p>
          <ul className="mt-2 space-y-1 text-sm">
            {(data?.by_status ?? []).map((s) => (
              <li key={s.status} className="flex justify-between">
                <span>{s.status}</span>
                <span className="font-medium">{s.count}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <p className="text-sm text-zinc-500">By category</p>
          <ul className="mt-2 space-y-1 text-sm">
            {(data?.by_category ?? []).map((c) => (
              <li key={c.name} className="flex justify-between">
                <span>{c.name}</span>
                <span className="font-medium">{c.count}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Card>
        <p className="text-sm text-zinc-500">By day</p>
        <ul className="mt-2 space-y-1 text-sm">
          {(data?.by_day ?? []).map((d) => (
            <li key={d.date} className="flex justify-between">
              <span>{d.date}</span>
              <span className="font-medium">{d.count}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
