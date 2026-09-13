"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, getApiBase, getToken } from "@/lib/api";
import type { AdminIncidentPage, DuplicatePair, Incident, Severity, StaffMember } from "@/lib/types";
import { INCIDENT_PAGE_SIZE, incidentScopeQuery, readIncidentScope } from "@/lib/incident-scope";
import { staffName } from "@/lib/types";
import { categoryLabel } from "@/lib/taxonomy";
import { slaFor, slaLabel } from "@/lib/sla";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { FeedbackPanel } from "@/components/ui/feedback-panel";
import { Input } from "@/components/ui/input";

const FONT = { fontFamily: "Verdana, Geneva, sans-serif" } as const;
const STATUSES = [
  "processing",
  "needs_review",
  "verified",
  "rejected",
  "escalated",
  "resolved",
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
  resolved: "Resolved",
  awaiting_verification: "Awaiting verification",
  community_confirmed: "Community confirmed",
  needs_follow_up: "Needs follow-up",
  closed: "Closed",
};
const SEVERITIES: Severity[] = ["low", "medium", "high", "critical"];
const SEV_BAR: Record<Severity, string> = {
  critical: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-yellow-500",
  low: "bg-zinc-300",
};

type BulkAction =
  | { kind: "status"; value: string; label: string }
  | { kind: "assigned_to"; value: string; label: string };

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

function labelFor(value: string): string {
  return STATUS_LABELS[value] ?? value.replaceAll("_", " ");
}

function thumbSrc(inc: Incident): string | null {
  if (!inc.photo_url) return null;
  const token = typeof window !== "undefined" ? getToken() ?? "" : "";
  return `${getApiBase()}/admin/incidents/${inc.id}/photo?token=${token}`;
}

function Thumb({ src }: { src: string | null }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-400">
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
      onLoad={(event) => {
        if (event.currentTarget.naturalWidth <= 8) setBroken(true);
      }}
      className="h-12 w-12 shrink-0 rounded-md bg-zinc-100 object-cover"
    />
  );
}

function SkeletonRows() {
  return (
    <div className="grid gap-2" aria-label="Loading incidents">
      {[0, 1, 2, 3].map((item) => (
        <Card key={item} className="flex animate-pulse items-center gap-3">
          <div className="h-4 w-4 rounded bg-zinc-200" />
          <div className="h-12 w-12 rounded-md bg-zinc-200" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-1/3 rounded bg-zinc-200" />
            <div className="h-3 w-2/3 rounded bg-zinc-100" />
          </div>
          <div className="h-3 w-16 rounded bg-zinc-100" />
        </Card>
      ))}
    </div>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-[#e8f0e5] px-2 py-1 text-xs font-medium text-[#285e4a]">
      {label}
      <button type="button" aria-label={`Remove ${label}`} onClick={onRemove} className="rounded px-1 text-[#285e4a] transition hover:bg-[#d7e5d2] focus:outline-none focus:ring-2 focus:ring-[#2a4a33]">×</button>
    </span>
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const scope = useMemo(() => readIncidentScope(searchParams), [searchParams]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [selectionMode, setSelectionMode] = useState<"page" | "filtered" | null>(null);
  const [bulkAssignee, setBulkAssignee] = useState("");
  const [pendingBulk, setPendingBulk] = useState<BulkAction | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["admin-incidents", scope],
    queryFn: () => apiFetch<AdminIncidentPage>(`/admin/incidents${incidentScopeQuery(scope)}`),
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

  const replaceScope = (updates: Partial<typeof scope>) => {
    const next = { ...scope, ...updates };
    if (updates.status) {
      next.state = "";
      next.sla = "";
    }
    if (updates.state === "resolved") {
      next.status = "";
      next.sla = "";
    }
    if (updates.sla) {
      next.state = "needs_attention";
      next.status = "";
    }
    const query = incidentScopeQuery(next, false);
    router.replace(`${pathname}${query}`, { scroll: false });
  };

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    setSelected({});
    setSelectionMode(null);
    setPendingBulk(null);
    setBulkAssignee("");
  }, [scope.q, scope.status, scope.severity, scope.queue, scope.window_days, scope.state, scope.sla, scope.sort, scope.page]);

  useEffect(() => {
    if (data && data.page !== scope.page) replaceScope({ page: data.page });
  }, [data, scope.page]);

  const staffById = useMemo(() => {
    const map = new Map<string, StaffMember>();
    (staff.data ?? []).forEach((member) => map.set(member.id, member));
    return map;
  }, [staff.data]);

  const ownerName = (id: string | null | undefined) => {
    if (!id) return "Unassigned";
    const member = staffById.get(id);
    return staffName(member?.email, id);
  };

  const dupCount = useMemo(() => {
    const map = new Map<string, DuplicatePair[]>();
    (dupes.data ?? []).forEach((pair) => {
      for (const id of [pair.a_id, pair.b_id]) {
        const list = map.get(id) ?? [];
        list.push(pair);
        map.set(id, list);
      }
    });
    return map;
  }, [dupes.data]);

  const rows = data?.items ?? [];
  const selectedIds = rows.filter((row) => selected[row.id]).map((row) => row.id);
  const selectedRows = rows.filter((row) => selected[row.id]);
  const commonBulkStatusActions = selectionMode === "page"
    ? (["verified", "rejected", "escalated"] as const).filter((status) =>
        selectedRows.every((row) => row.allowed_statuses?.includes(status)),
      )
    : [];
  const pageSelected = rows.length > 0 && rows.every((row) => selected[row.id]);
  const hasScope = !!scope.q || !!scope.status || !!scope.severity || !!scope.queue || !!scope.window_days || !!scope.state || !!scope.sla || scope.sort !== "newest" || scope.page > 1;
  const total = data?.total ?? 0;
  const totalPages = data?.total_pages ?? 0;
  const firstResult = total === 0 ? 0 : (scope.page - 1) * INCIDENT_PAGE_SIZE + 1;
  const lastResult = total === 0 ? 0 : Math.min(scope.page * INCIDENT_PAGE_SIZE, total);

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["admin-incidents"] });
    qc.invalidateQueries({ queryKey: ["admin-recent"] });
    qc.invalidateQueries({ queryKey: ["admin-duplicates"] });
    qc.invalidateQueries({ queryKey: ["admin-staff"] });
    qc.invalidateQueries({ queryKey: ["sidebar-needs-review"] });
  };

  const bulk = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiFetch<{ matched: number; updated: number }>("/admin/incidents/bulk", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (result) => {
      setSelected({});
      setSelectionMode(null);
      setBulkAssignee("");
      setPendingBulk(null);
      setToast(`${result.updated} of ${result.matched} incident${result.matched === 1 ? "" : "s"} updated`);
      refreshAll();
    },
  });

  const currentFilterPayload = {
    q: scope.q || null,
    status: scope.status || null,
    severity: scope.severity || null,
    queue: scope.queue || null,
    window_days: scope.window_days,
    state: scope.state || null,
    sla: scope.sla || null,
  };

  const confirmBulk = () => {
    if (!pendingBulk || selectionMode === null) return;
    const target = selectionMode === "filtered" ? { scope: "filtered", filters: currentFilterPayload } : { ids: selectedIds };
    bulk.mutate({ ...target, [pendingBulk.kind]: pendingBulk.value });
  };

  const clearAll = () => {
    setSelected({});
    setSelectionMode(null);
    router.replace(pathname, { scroll: false });
  };

  const clearOne = (key: keyof typeof scope) => {
    if (key === "q" || key === "status" || key === "severity" || key === "queue" || key === "state" || key === "sla") replaceScope({ [key]: "", page: 1 });
    else if (key === "window_days") replaceScope({ window_days: null, page: 1 });
    else if (key === "sort") replaceScope({ sort: "newest", page: 1 });
    else replaceScope({ page: 1 });
  };

  const selectPage = (checked: boolean) => {
    if (!checked) {
      setSelected({});
      setSelectionMode(null);
      return;
    }
    const next: Record<string, boolean> = {};
    rows.forEach((row) => (next[row.id] = true));
    setSelected(next);
    setSelectionMode("page");
  };

  const selectRow = (id: string, checked: boolean) => {
    setSelectionMode("page");
    setSelected((current) => {
      const next = { ...current, [id]: checked };
      if (!checked) delete next[id];
      return next;
    });
  };

  const selectionCount = selectionMode === "filtered" ? total : selectedIds.length;
  const selectionText = selectionMode === "filtered" ? `All ${total} matching incidents selected` : `${selectionCount} incident${selectionCount === 1 ? "" : "s"} selected on this page`;
  const selectCls = "rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm capitalize outline-none transition focus:border-[#2a4a33] focus:ring-2 focus:ring-[#dce8dc]";

  return (
    <div className="mx-auto max-w-[1500px] space-y-6 pb-10" style={FONT}>
      <PageHeader
        eyebrow="Review queue"
        title="Incidents"
        description="Scan reports, focus the right queue, and move each incident to its next safe action."
        meta={<span aria-live="polite">{isLoading ? "Loading queue…" : `${total} matching incident${total === 1 ? "" : "s"}`}</span>}
      />
      <Card className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full min-w-0 sm:min-w-56 sm:flex-1">
            <label htmlFor="inc-search" className="mb-1 block text-xs font-medium text-zinc-500">Search</label>
            <Input id="inc-search" placeholder="Search title or description…" value={scope.q} onChange={(event) => replaceScope({ q: event.target.value.slice(0, 100), page: 1 })} className="focus:border-[#2a4a33] focus:ring-[#dce8dc]" />
          </div>
          <div className="w-full sm:w-auto">
            <label htmlFor="inc-status" className="mb-1 block text-xs font-medium text-zinc-500">Status</label>
            <select id="inc-status" className={`${selectCls} w-full sm:w-auto`} value={scope.status} onChange={(event) => replaceScope({ status: event.target.value, page: 1 })}>
              <option value="">All statuses</option>
              {STATUSES.map((value) => <option key={value} value={value}>{STATUS_LABELS[value]}</option>)}
            </select>
          </div>
          <div className="w-full sm:w-auto">
            <label htmlFor="inc-sev" className="mb-1 block text-xs font-medium text-zinc-500">Severity</label>
            <select id="inc-sev" className={`${selectCls} w-full sm:w-auto`} value={scope.severity} onChange={(event) => replaceScope({ severity: event.target.value, page: 1 })}>
              <option value="">All severities</option>
              {SEVERITIES.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </div>
          <div className="w-full sm:w-auto">
            <label htmlFor="inc-queue" className="mb-1 block text-xs font-medium text-zinc-500">Queue</label>
            <select id="inc-queue" className={`${selectCls} w-full sm:w-auto`} value={scope.queue} onChange={(event) => replaceScope({ queue: event.target.value as typeof scope.queue, page: 1 })}>
              <option value="">All incidents</option>
              <option value="mine">My queue — open and assigned to you</option>
              <option value="unassigned">Unassigned — open with no owner</option>
            </select>
          </div>
          <div className="w-full sm:w-auto">
            <label htmlFor="inc-sort" className="mb-1 block text-xs font-medium text-zinc-500">Sort</label>
            <select id="inc-sort" className={`${selectCls} w-full sm:w-auto`} value={scope.sort} onChange={(event) => replaceScope({ sort: event.target.value as typeof scope.sort, page: 1 })}>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="severity">Highest severity</option>
              <option value="action">Needs action</option>
            </select>
          </div>
          {hasScope && <button type="button" onClick={clearAll} className="inline-flex items-center justify-center rounded-md bg-white px-4 py-2 text-sm font-medium text-zinc-700 ring-1 ring-inset ring-zinc-300 transition hover:bg-zinc-100 focus:outline-none focus:ring-2 focus:ring-[#2a4a33]">Clear all</button>}
        </div>

        <div className="flex flex-wrap items-center gap-2" aria-label="Active incident scope">
          {scope.q && <FilterChip label={`Search: ${scope.q}`} onRemove={() => clearOne("q")} />}
          {scope.status && <FilterChip label={`Status: ${labelFor(scope.status)}`} onRemove={() => clearOne("status")} />}
          {scope.severity && <FilterChip label={`Severity: ${scope.severity}`} onRemove={() => clearOne("severity")} />}
          {scope.queue === "mine" && <FilterChip label="Queue: My queue — open and assigned to you" onRemove={() => clearOne("queue")} />}
          {scope.queue === "unassigned" && <FilterChip label="Queue: Unassigned — open with no owner" onRemove={() => clearOne("queue")} />}
          {scope.window_days && <FilterChip label={`Last ${scope.window_days} days`} onRemove={() => clearOne("window_days")} />}
          {scope.state && <FilterChip label={`State: ${scope.state === "needs_attention" ? "Needs attention" : "Resolved"}`} onRemove={() => clearOne("state")} />}
          {scope.sla && <FilterChip label={`SLA: ${scope.sla === "overdue" ? "Overdue" : "Breaching"}`} onRemove={() => clearOne("sla")} />}
          {scope.sort !== "newest" && <FilterChip label={`Sort: ${scope.sort === "action" ? "Needs action" : scope.sort}`} onRemove={() => clearOne("sort")} />}
          {!hasScope && <span className="text-xs text-zinc-500">All incidents · newest first</span>}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 pt-3">
          <p className="text-sm text-zinc-500" aria-live="polite">{isLoading ? "Loading incidents…" : `Showing ${firstResult}–${lastResult} of ${total} incident${total === 1 ? "" : "s"}`}{isFetching && !isLoading && <span className="ml-2 text-xs text-zinc-400">Refreshing…</span>}</p>
          {(dupes.data ?? []).length > 0 && <span className="rounded-md bg-purple-50 px-2 py-1 text-xs font-medium text-purple-800">{dupes.data?.length} suspected duplicate pairs</span>}
        </div>
      </Card>

      {selectionMode && selectionCount > 0 && (
        <Card className="space-y-3 border-[#2a4a33] bg-[#f2f6f0]" role="region" aria-label="Bulk actions">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="mr-2 text-sm">{selectionText}</strong>
            {commonBulkStatusActions.map((value) => {
              const label = value === "verified" ? "Approve" : value === "rejected" ? "Reject" : "Escalate";
              return <button key={value} type="button" disabled={bulk.isPending} onClick={() => setPendingBulk({ kind: "status", value, label })} className="inline-flex items-center justify-center rounded-md bg-[#14231a] px-3 py-1.5 text-sm font-medium text-white transition hover:bg-[#2a4a33] active:translate-y-px disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#2a4a33] focus:ring-offset-2">{label}</button>;
            })}
            {selectionMode === "filtered" ? <p className="text-xs text-zinc-600">Select compatible incidents on this page to change status in bulk. Select-all matching is available for assignment only.</p> : commonBulkStatusActions.length === 0 && <p className="text-xs text-zinc-600">No shared status action is available for every selected incident.</p>}
            <select aria-label="Bulk assign to staff" className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-[#2a4a33] focus:ring-2 focus:ring-[#dce8dc]" value={bulkAssignee} onChange={(event) => setBulkAssignee(event.target.value)}>
              <option value="">Assign to…</option>
              {(staff.data ?? []).map((member) => <option key={member.id} value={member.id}>{staffName(member.email, member.id)} ({member.role})</option>)}
            </select>
            <button type="button" disabled={!bulkAssignee || bulk.isPending} onClick={() => setPendingBulk({ kind: "assigned_to", value: bulkAssignee, label: "Assign" })} className="inline-flex items-center justify-center rounded-md bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 ring-1 ring-inset ring-zinc-300 transition hover:bg-zinc-100 active:translate-y-px disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#2a4a33]">Assign</button>
            <button type="button" onClick={() => { setSelected({}); setSelectionMode(null); setBulkAssignee(""); }} className="ml-auto text-sm text-zinc-500 transition hover:text-zinc-800 focus:outline-none focus:ring-2 focus:ring-[#2a4a33]">Clear selection</button>
          </div>
          {selectionMode === "page" && pageSelected && total > rows.length && <button type="button" onClick={() => setSelectionMode("filtered")} className="text-left text-sm font-medium text-[#285e4a] underline decoration-[#9bbb91] underline-offset-2 hover:text-[#14231a] focus:outline-none focus:ring-2 focus:ring-[#2a4a33]">Select all {total} matching incidents</button>}
          {pendingBulk && <div className="flex flex-wrap items-center gap-3 border-t border-[#cbdcc6] pt-3" role="alert"><p className="max-w-2xl flex-1 text-sm text-zinc-700">Confirm <strong>{pendingBulk.label.toLowerCase()}</strong> for <strong>{selectionCount}</strong> incident{selectionCount === 1 ? "" : "s"} {selectionMode === "filtered" ? "matching the current filters" : "on this page"}.</p><button type="button" onClick={() => setPendingBulk(null)} disabled={bulk.isPending} className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 ring-1 ring-inset ring-zinc-300 hover:bg-zinc-100 focus:outline-none focus:ring-2 focus:ring-[#2a4a33]">Cancel</button><button type="button" onClick={confirmBulk} disabled={bulk.isPending} className="rounded-md bg-[#14231a] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#2a4a33] disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#2a4a33] focus:ring-offset-2">{bulk.isPending ? "Applying…" : `Confirm ${pendingBulk.label.toLowerCase()}`}</button></div>}
          {bulk.error && <p className="text-sm text-red-700" role="alert">Bulk action failed: {(bulk.error as Error).message}</p>}
        </Card>
      )}

      {isLoading && <SkeletonRows />}
      {error && !isLoading && <FeedbackPanel variant="error" title="Incidents could not load" description={(error as Error).message} action={<Button onClick={() => refetch()} className="bg-[#14231a] hover:bg-[#2a4a33]">Retry</Button>} />}
      {!isLoading && !error && rows.length === 0 && <FeedbackPanel title="No incidents match this scope" description={hasScope ? "Try removing a filter or clear all to return to the full queue." : "There are no incidents in the current queue."} action={hasScope ? <Button onClick={clearAll} className="bg-[#14231a] hover:bg-[#2a4a33]">Clear all</Button> : undefined} />}

      {!isLoading && !error && rows.length > 0 && <section aria-label="Incident results" className="space-y-2"><div className="flex items-center gap-2 px-1 text-xs text-zinc-500"><input type="checkbox" aria-label={`Select page (${rows.length})`} checked={pageSelected} onChange={(event) => selectPage(event.target.checked)} className="h-4 w-4 accent-[#2a4a33]" /><span>Select page ({rows.length})</span></div><div className="grid gap-2">{rows.map((inc) => { const src = thumbSrc(inc); const location = inc.address ?? `${inc.lat.toFixed(3)}, ${inc.lng.toFixed(3)}`; const sla = slaFor(inc.created_at, inc.severity, inc.status); const duplicates = dupCount.get(inc.id) ?? []; const owner = ownerName(inc.assigned_to); return <Card key={inc.id} className="relative overflow-hidden p-3 transition-shadow hover:shadow-md"><span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${SEV_BAR[inc.severity]}`} /><div className="grid gap-3 pl-2 xl:grid-cols-[auto_auto_minmax(18rem,1fr)_minmax(130px,auto)_minmax(105px,auto)_auto] xl:items-center"><input type="checkbox" aria-label={`Select ${inc.title}`} checked={!!selected[inc.id]} onChange={(event) => selectRow(inc.id, event.target.checked)} className="h-4 w-4 accent-[#2a4a33]" /><Thumb src={src} /><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Link href={`/incidents/${inc.id}`} className="max-w-full font-semibold text-zinc-900 underline-offset-2 transition hover:text-[#2a4a33] hover:underline focus:outline-none focus:ring-2 focus:ring-[#2a4a33]">{inc.title}</Link>{duplicates.length > 0 && <Link href={`/incidents/${inc.id}#duplicates`} title={duplicates.map((item) => `Score ${item.score} · ${item.distance_m}m · ${item.hours_apart}h apart`).join("\n")} className="rounded-md bg-purple-50 px-1.5 py-0.5 text-[11px] font-bold text-purple-800 hover:bg-purple-100 focus:outline-none focus:ring-2 focus:ring-[#2a4a33]">{duplicates.length} duplicate{duplicates.length > 1 ? "s" : ""}</Link>}</div><p className="mt-0.5 truncate text-xs text-zinc-500" title={location}>{location}</p><p className="mt-1 line-clamp-2 max-w-2xl text-sm leading-relaxed text-zinc-600">{inc.description || "No description provided."}</p></div><div className="flex flex-wrap items-center gap-1.5 xl:justify-end">{sla && sla.state !== "ok" && <span title={slaLabel(sla)} className={`rounded-md px-2 py-1 text-xs font-bold ${sla.state === "overdue" ? "bg-red-600 text-white" : "bg-amber-100 text-amber-800"}`}>{sla.state === "overdue" ? "Overdue" : "Breaching"}</span>}<Badge value={inc.status} /><Badge value={inc.severity} /></div><div className="text-xs text-zinc-500"><span className="text-[11px] uppercase tracking-wide text-zinc-400">Owner</span><span className="mt-0.5 block truncate" title={owner}>{owner}</span></div><div className="flex items-center justify-between gap-3 text-xs text-zinc-500 xl:block xl:text-right"><span className="text-[11px] uppercase tracking-wide text-zinc-400">Age</span><span className="mt-0.5 block tabular-nums" title={new Date(inc.created_at).toLocaleString()}>{timeAgo(inc.created_at)}</span><Link href={`/incidents/${inc.id}`} className="mt-1 inline-block font-medium text-[#285e4a] hover:underline focus:outline-none focus:ring-2 focus:ring-[#2a4a33]">Open incident</Link></div></div></Card>; })}</div></section>}

      {!isLoading && !error && totalPages > 0 && <nav aria-label="Incident pages" className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 pt-3"><p className="text-xs text-zinc-500">Page {scope.page} of {totalPages}</p><div className="flex items-center gap-2"><button type="button" disabled={scope.page <= 1} onClick={() => replaceScope({ page: scope.page - 1 })} className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 ring-1 ring-inset ring-zinc-300 transition hover:bg-zinc-100 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-[#2a4a33]">Previous</button><button type="button" disabled={scope.page >= totalPages} onClick={() => replaceScope({ page: scope.page + 1 })} className="rounded-md bg-[#14231a] px-3 py-1.5 text-sm font-medium text-white transition hover:bg-[#2a4a33] disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-[#2a4a33] focus:ring-offset-2">Next</button></div></nav>}
      {toast && <div role="status" className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm text-white shadow-lg">{bulk.isPending ? "Applying…" : toast}</div>}
    </div>
  );
}
