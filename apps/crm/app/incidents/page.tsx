"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, buildQuery, getApiBase, getToken } from "@/lib/api";
import type { DuplicatePair, Incident, Severity, StaffMember } from "@/lib/types";
import { staffName } from "@/lib/types";
import { categoryLabel } from "@/lib/taxonomy";
import { slaFor, slaLabel } from "@/lib/sla";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const FONT = { fontFamily: "Verdana, Geneva, sans-serif" } as const;

const STATUSES = [
  "processing",
  "needs_review",
  "verified",
  "rejected",
  "escalated",
  "awaiting_verification",
  "community_confirmed",
  "needs_follow_up",
  "closed",
];
const STATUS_LABELS: Record<string, string> = {
  processing: "Processing",
  needs_review: "Needs review",
  verified: "Verified",
  rejected: "Rejected",
  escalated: "Escalated",
  awaiting_verification: "Awaiting verification",
  community_confirmed: "Community confirmed",
  needs_follow_up: "Needs follow-up",
  closed: "Closed",
};
const SEVERITIES: Severity[] = ["low", "medium", "high", "critical"];
const SEV_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const SEV_BAR: Record<Severity, string> = {
  critical: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-yellow-500",
  low: "bg-zinc-300",
};

type SortKey = "newest" | "oldest" | "severity" | "action";

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
  return (
    <Suspense fallback={<p>Loading incidents…</p>}>
      <IncidentsInner />
    </Suspense>
  );
}

function IncidentsInner() {
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState("");
  const [severity, setSeverity] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>(
    searchParams.get("sort") === "action" ? "action" : "newest"
  );
  const [mineOnly, setMineOnly] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [bulkAssignee, setBulkAssignee] = useState("");
  const [toast, setToast] = useState<{ msg: string; undo: () => void } | null>(null);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["admin-incidents", status, severity],
    queryFn: () =>
      apiFetch<Incident[]>(`/admin/incidents${buildQuery({ status, severity })}`),
  });
  const me = useQuery({
    queryKey: ["admin-me"],
    queryFn: () => apiFetch<{ id: string; email: string; role: string }>("/admin/me"),
    retry: false,
  });
  const staff = useQuery({
    queryKey: ["admin-staff"],
    queryFn: () => apiFetch<StaffMember[]>("/admin/staff"),
    retry: false,
  });
  const dupes = useQuery({
    queryKey: ["admin-duplicates"],
    queryFn: () => apiFetch<DuplicatePair[]>("/admin/incidents/duplicates"),
    retry: false,
  });

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const staffById = useMemo(() => {
    const m = new Map<string, StaffMember>();
    (staff.data ?? []).forEach((s) => m.set(s.id, s));
    return m;
  }, [staff.data]);

  const ownerName = (id: string | null | undefined) => {
    if (!id) return null;
    const s = staffById.get(id);
    return staffName(s?.email, id);
  };

  const dupCount = useMemo(() => {
    const m = new Map<string, DuplicatePair[]>();
    (dupes.data ?? []).forEach((p) => {
      for (const id of [p.a_id, p.b_id]) {
        const list = m.get(id) ?? [];
        list.push(p);
        m.set(id, list);
      }
    });
    return m;
  }, [dupes.data]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = (data ?? []).filter((i) => {
      if (mineOnly && me.data && i.assigned_to !== me.data.id) return false;
      return (
        !q ||
        i.title.toLowerCase().includes(q) ||
        (i.description ?? "").toLowerCase().includes(q)
      );
    });
    return [...filtered].sort((a, b) => {
      if (sort === "oldest")
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (sort === "severity") return SEV_RANK[a.severity] - SEV_RANK[b.severity];
      if (sort === "action") {
        const sa = slaFor(a.created_at, a.severity, a.status);
        const sb = slaFor(b.created_at, b.severity, b.status);
        const rank = (s: typeof sa) => (!s ? 3 : s.state === "overdue" ? 0 : s.state === "breaching" ? 1 : 2);
        const d = rank(sa) - rank(sb);
        if (d !== 0) return d;
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [data, query, sort, mineOnly, me.data]);

  const selectedIds = useMemo(
    () => rows.filter((r) => selected[r.id]).map((r) => r.id),
    [rows, selected]
  );
  const allChecked = rows.length > 0 && rows.every((r) => selected[r.id]);

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["admin-incidents"] });
    qc.invalidateQueries({ queryKey: ["admin-duplicates"] });
    qc.invalidateQueries({ queryKey: ["admin-staff"] });
  };

  const bulk = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<{ updated: number }>(`/admin/incidents/bulk`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: refreshAll,
  });

  const patchOne = (id: string, body: Record<string, unknown>) =>
    apiFetch(`/admin/incidents/${id}`, { method: "PATCH", body: JSON.stringify(body) });

  /** Restore a snapshot of rows (for bulk undo). Sequential, best-effort. */
  const restoreSnapshot = async (snap: Incident[]) => {
    for (const s of snap) {
      try {
        await patchOne(s.id, { status: s.status, severity: s.severity });
        await patchOne(s.id, { assigned_to: s.assigned_to ?? null });
      } catch {
        /* keep going */
      }
    }
    refreshAll();
  };

  const runBulk = (body: Record<string, unknown>, label: string) => {
    const snap = rows.filter((r) => selected[r.id]);
    bulk.mutate(
      { ids: selectedIds, ...body },
      {
        onSuccess: () => {
          setSelected({});
          setBulkAssignee("");
          setToast({ msg: label, undo: () => restoreSnapshot(snap) });
        },
      }
    );
  };

  const hasFilters = !!status || !!severity || !!query || mineOnly;

  const clearAll = () => {
    setStatus("");
    setSeverity("");
    setQuery("");
    setMineOnly(false);
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
                  {STATUS_LABELS[s] ?? s}
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
              <option value="action">Needs action</option>
            </select>
          </div>
          <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={mineOnly}
              onChange={(e) => setMineOnly(e.target.checked)}
              className="accent-[#2a4a33]"
            />
            My queue{me.data ? ` (${(data ?? []).filter((r) => r.assigned_to === me.data.id).length})` : ""}
          </label>
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
              {(dupes.data ?? []).length > 0 && (
                <span className="ml-2 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800">
                  {(dupes.data ?? []).length} suspected duplicate pairs
                </span>
              )}
              {isFetching && !isLoading && " · refreshing…"}
            </>
          )}
        </p>
      </Card>

      {/* Bulk action bar */}
      {selectedIds.length > 0 && (
        <Card className="flex flex-wrap items-center gap-2 border-[#2a4a33] bg-[#f2f6f0]">
          <strong className="text-sm">{selectedIds.length} selected</strong>
          {(
            [
              ["verified", "Approve"],
              ["rejected", "Reject"],
              ["escalated", "Escalate"],
            ] as const
          ).map(([s, label]) => (
            <button
              key={s}
              disabled={bulk.isPending}
              onClick={() => runBulk({ status: s }, `${selectedIds.length} set to ${s}`)}
              className="inline-flex items-center justify-center rounded-md bg-[#14231a] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#2a4a33] disabled:opacity-50"
            >
              {label}
            </button>
          ))}
          <select
            aria-label="Bulk assign to staff"
            className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-[#2a4a33]"
            value={bulkAssignee}
            onChange={(e) => setBulkAssignee(e.target.value)}
          >
            <option value="">Assign to…</option>
            {(staff.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {staffName(s.email, s.id)} ({s.role})
              </option>
            ))}
          </select>
          <button
            disabled={!bulkAssignee || bulk.isPending}
            onClick={() => runBulk({ assigned_to: bulkAssignee }, `${selectedIds.length} assigned`)}
            className="inline-flex items-center justify-center rounded-md bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 ring-1 ring-inset ring-zinc-300 hover:bg-zinc-100 disabled:opacity-50"
          >
            Assign
          </button>
          <button
            onClick={() => setSelected({})}
            className="ml-auto text-sm text-zinc-500 hover:text-zinc-800"
          >
            Clear selection
          </button>
        </Card>
      )}

      {isLoading && <SkeletonRows />}

      {error && !isLoading && (
        <Card className="border-red-200 bg-red-50 text-center">
          <p className="text-sm text-red-700">Couldn't load incidents: {(error as Error).message}</p>
          <Button onClick={() => refetch()} className="mt-3">
            Retry
          </Button>
        </Card>
      )}

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
        {rows.length > 0 && (
          <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-500">
            <input
              type="checkbox"
              checked={allChecked}
              onChange={(e) => {
                const next: Record<string, boolean> = {};
                if (e.target.checked) rows.forEach((r) => (next[r.id] = true));
                setSelected(next);
              }}
              className="accent-[#2a4a33]"
            />
            Select all {rows.length} shown
          </label>
        )}
        {rows.map((inc) => {
          const src = thumbSrc(inc);
          const loc = inc.address ?? `${inc.lat.toFixed(3)}, ${inc.lng.toFixed(3)}`;
          const sla = slaFor(inc.created_at, inc.severity, inc.status);
          const owner = ownerName(inc.assigned_to);
          const dups = dupCount.get(inc.id) ?? [];
          return (
            <Card key={inc.id} className="relative overflow-hidden">
              <span
                aria-hidden
                className={`absolute inset-y-0 left-0 w-1.5 ${SEV_BAR[inc.severity]}`}
              />
              <div className="flex items-center gap-4 pl-2">
                <input
                  type="checkbox"
                  aria-label={`Select ${inc.title}`}
                  checked={!!selected[inc.id]}
                  onChange={(e) =>
                    setSelected((m) => ({ ...m, [inc.id]: e.target.checked }))
                  }
                  className="h-4 w-4 shrink-0 accent-[#2a4a33]"
                />
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
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 capitalize">
                    <Badge value={inc.status} />
                    <Badge value={inc.severity} />
                    <span className="rounded-full bg-[#e8f0e5] px-2 py-0.5 text-xs font-medium normal-case text-[#285e4a]">
                      {categoryLabel(inc.ai_analysis?.category)}
                    </span>
                    {sla && sla.state !== "ok" && (
                      <span
                        title={slaLabel(sla)}
                        className={`rounded-full px-2 py-0.5 text-xs font-bold normal-case ${
                          sla.state === "overdue"
                            ? "bg-red-600 text-white"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {sla.state === "overdue" ? "Overdue" : "Breaching"}
                      </span>
                    )}
                    {dups.length > 0 && (
                      <Link
                        href={`/incidents/${inc.id}#duplicates`}
                        title={dups
                          .map((d) => `Score ${d.score} · ${d.distance_m}m · ${d.hours_apart}h apart`)
                          .join("\n")}
                        className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-bold normal-case text-purple-800 hover:bg-purple-200"
                      >
                        {dups.length} possible duplicate{dups.length > 1 ? "s" : ""}
                      </Link>
                    )}
                    <span className="inline-flex items-center gap-1 text-xs normal-case text-zinc-500" title={owner ? `Assigned to ${owner}` : "Unassigned"}>
                      <span aria-hidden className={`inline-block h-1.5 w-1.5 rounded-full ${owner ? "bg-green-500" : "bg-zinc-300"}`} />
                      {owner ?? "Unassigned"}
                    </span>
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

      {/* Toast */}
      {toast && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm text-white shadow-lg"
        >
          {bulk.isPending ? "Applying…" : toast.msg}
          <button
            onClick={() => {
              const t = toast;
              setToast(null);
              t.undo();
            }}
            className="rounded px-2 py-0.5 font-medium text-amber-300 hover:bg-white/10"
          >
            Undo
          </button>
        </div>
      )}
    </div>
  );
}
