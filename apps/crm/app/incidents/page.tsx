"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiFetch, buildQuery, getApiBase, getToken } from "@/lib/api";
import type { Incident, Severity } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const FONT = { fontFamily: "Verdana, Geneva, sans-serif" } as const;

const STATUSES = ["processing", "needs_review", "verified", "rejected", "escalated", "resolved", "closed"];
const SEVERITIES: Severity[] = ["low", "medium", "high", "critical"];
const SEV_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const SEV_BAR: Record<Severity, string> = {
  critical: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-yellow-500",
  low: "bg-zinc-300",
};

type SortKey = "newest" | "oldest" | "severity";

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

function thumbSrc(inc: Incident): string | null {
  if (!inc.photo_url) return null;
  const t = typeof window !== "undefined" ? (getToken() ?? "") : "";
  return `${getApiBase()}/admin/incidents/${inc.id}/photo?token=${t}`;
}

function Thumb({ src }: { src: string | null }) {
  const [broken, setBroken] = useState(false);
  // The backend serves a 1px placeholder when no real photo exists —
  // treat tiny/broken images as "no photo" so rows never show color bars.
  if (!src || broken) {
    return (
      <span
        aria-hidden
        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-400"
      >
        <svg viewBox="0 0 20 20" fill="none" className="h-6 w-6">
          <rect x="2.5" y="4" width="15" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="7" cy="9" r="1.6" stroke="currentColor" strokeWidth="1.5" />
          <path d="M4 14.5l3.5-3.5 2.5 2.5 2-2 4 3" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setBroken(true)}
      onLoad={(e) => {
        if (e.currentTarget.naturalWidth <= 8) setBroken(true);
      }}
      className="h-14 w-14 shrink-0 rounded-lg bg-zinc-100 object-cover"
    />
  );
}

function SkeletonRows() {
  return (
    <div className="grid gap-3" aria-label="Loading incidents">
      {[0, 1, 2].map((i) => (
        <Card key={i} className="flex animate-pulse items-center gap-4">
          <div className="h-14 w-14 shrink-0 rounded-lg bg-zinc-200" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-1/3 rounded bg-zinc-200" />
            <div className="h-3 w-2/3 rounded bg-zinc-100" />
          </div>
          <div className="h-3 w-20 rounded bg-zinc-100" />
        </Card>
      ))}
    </div>
  );
}

export default function IncidentsPage() {
  const [status, setStatus] = useState("");
  const [severity, setSeverity] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["admin-incidents", status, severity],
    queryFn: () =>
      apiFetch<Incident[]>(`/admin/incidents${buildQuery({ status, severity })}`),
  });

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = (data ?? []).filter(
      (i) =>
        !q ||
        i.title.toLowerCase().includes(q) ||
        (i.description ?? "").toLowerCase().includes(q)
    );
    return [...filtered].sort((a, b) => {
      if (sort === "oldest")
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (sort === "severity") return SEV_RANK[a.severity] - SEV_RANK[b.severity];
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [data, query, sort]);

  const hasFilters = !!status || !!severity || !!query;

  const clearAll = () => {
    setStatus("");
    setSeverity("");
    setQuery("");
  };

  const selectCls =
    "rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm capitalize outline-none focus:border-[#2a4a33]";

  return (
    <div className="space-y-4" style={FONT}>
      {/* Toolbar — page title lives in the shell banner */}
      <Card className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-52 flex-1">
            <label htmlFor="inc-search" className="mb-1 block text-xs font-medium text-zinc-500">
              Search
            </label>
            <Input
              id="inc-search"
              placeholder="Search title or description…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="focus:border-[#2a4a33]"
            />
          </div>
          <div>
            <label htmlFor="inc-status" className="mb-1 block text-xs font-medium text-zinc-500">
              Status
            </label>
            <select
              id="inc-status"
              className={selectCls}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s} className="capitalize">
                  {s.replace("_", " ")}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="inc-sev" className="mb-1 block text-xs font-medium text-zinc-500">
              Severity
            </label>
            <select
              id="inc-sev"
              className={selectCls}
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
            >
              <option value="">All severities</option>
              {SEVERITIES.map((s) => (
                <option key={s} value={s} className="capitalize">
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="inc-sort" className="mb-1 block text-xs font-medium text-zinc-500">
              Sort
            </label>
            <select
              id="inc-sort"
              className={selectCls}
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="severity">Highest severity</option>
            </select>
          </div>
          {hasFilters && (
            <button
              onClick={clearAll}
              className="inline-flex items-center justify-center rounded-md bg-white px-4 py-2 text-sm font-medium text-zinc-700 ring-1 ring-inset ring-zinc-300 hover:bg-zinc-100"
            >
              Clear filters
            </button>
          )}
        </div>
        <p className="text-sm text-zinc-500" aria-live="polite">
          {isLoading ? (
            "Loading incidents…"
          ) : (
            <>
              <strong className="text-zinc-800">{rows.length}</strong>{" "}
              {rows.length === 1 ? "incident" : "incidents"}
              {isFetching && !isLoading && " · refreshing…"}
            </>
          )}
        </p>
      </Card>

      {isLoading && <SkeletonRows />}

      {!isLoading && !error && rows.length === 0 && (
        <Card className="py-10 text-center">
          <svg viewBox="0 0 48 48" fill="none" className="mx-auto h-12 w-12 text-zinc-300" aria-hidden>
            <circle cx="22" cy="22" r="12" stroke="currentColor" strokeWidth="3" />
            <path d="M31 31l9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <p className="mt-3 font-medium text-zinc-800">No incidents match</p>
          <p className="mt-1 text-sm text-zinc-500">
            {hasFilters ? "Try widening the search or clearing the filters." : "Nothing reported yet."}
          </p>
          {hasFilters && (
            <Button onClick={clearAll} className="mt-4">
              Reset filters
            </Button>
          )}
        </Card>
      )}

      <div className="grid gap-3">
        {rows.map((inc) => {
          const src = thumbSrc(inc);
          const loc = inc.address ?? `${inc.lat.toFixed(3)}, ${inc.lng.toFixed(3)}`;
          return (
            <Card key={inc.id} className="relative overflow-hidden">
              <span
                aria-hidden
                className={`absolute inset-y-0 left-0 w-1.5 ${SEV_BAR[inc.severity]}`}
              />
              <div className="flex items-center gap-4 pl-2">
                <Thumb src={src} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Link
                      href={`/incidents/${inc.id}`}
                      className="truncate font-semibold text-zinc-900 hover:text-[#2a4a33] hover:no-underline"
                    >
                      {inc.title}
                    </Link>
                  </div>
                  <p className="mt-0.5 truncate text-sm text-zinc-500">
                    {loc}
                    {inc.description ? ` · ${inc.description}` : ""}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5 capitalize">
                    <Badge value={inc.status} />
                    <Badge value={inc.severity} />
                  </div>
                </div>
                <span
                  className="shrink-0 text-xs tabular-nums text-zinc-500"
                  title={new Date(inc.created_at).toLocaleString()}
                >
                  {timeAgo(inc.created_at)}
                </span>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
