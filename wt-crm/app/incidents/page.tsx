"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiFetch, buildQuery } from "@/lib/api";
import type { Incident } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

const STATUSES = ["", "processing", "needs_review", "verified", "rejected", "escalated", "resolved", "closed"];
const SEVERITIES = ["", "low", "medium", "high", "critical"];

export default function IncidentsPage() {
  const [status, setStatus] = useState("");
  const [severity, setSeverity] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-incidents", status, severity],
    queryFn: () =>
      apiFetch<Incident[]>(`/admin/incidents${buildQuery({ status, severity })}`),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Incidents</h1>
      <div className="flex gap-2">
        <select
          className="rounded-md border px-3 py-2 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s || "all statuses"}</option>
          ))}
        </select>
        <select
          className="rounded-md border px-3 py-2 text-sm"
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
        >
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>{s || "all severities"}</option>
          ))}
        </select>
      </div>
      {isLoading && <p>Loading…</p>}
      {error && <p className="text-red-600">{(error as Error).message}</p>}
      <div className="grid gap-3">
        {(data ?? []).map((inc) => (
          <Card key={inc.id}>
            <div className="flex items-center gap-2">
              <Link href={`/incidents/${inc.id}`} className="font-medium underline">
                {inc.title}
              </Link>
              <Badge value={inc.status} />
              <Badge value={inc.severity} />
              <span className="ml-auto text-xs text-zinc-500">
                {new Date(inc.created_at).toLocaleString()}
              </span>
            </div>
            <p className="mt-1 text-sm text-zinc-600">{inc.description}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
