"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { keepPreviousData } from "@tanstack/react-query";
import { apiFetch, getApiBase, getToken } from "@/lib/api";
import type { AdminIncidentPage, DuplicatePair, Incident, Severity, StaffMember } from "@/lib/types";
import { INCIDENT_PAGE_SIZE, incidentScopeQuery, readIncidentScope } from "@/lib/incident-scope";
import { staffName } from "@/lib/types";
import { categoryLabel } from "@/lib/taxonomy";
import { slaFor } from "@/lib/sla";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FeedbackPanel } from "@/components/ui/feedback-panel";
import { Input } from "@/components/ui/input";
import { NavigationLink } from "@/components/ui/navigation-link";

const FONT = { fontFamily: "Verdana, Geneva, sans-serif" } as const;
const STATUSES = [
  "processing",
  "needs_review",
  "verified",
  "rejected",
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
      <span aria-hidden className="flex h-[60px] w-[60px] shrink-0 items-center justify-center rounded-md bg-[#eef2f0] text-zinc-400">
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
      alt="Incident evidence"
      loading="lazy"
      onError={() => setBroken(true)}
      onLoad={(event) => {
        if (event.currentTarget.naturalWidth <= 8) setBroken(true);
      }}
      className="h-[60px] w-[60px] shrink-0 rounded-md bg-zinc-100 object-cover"
    />
  );
}

function SearchIcon() {
  return <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden><circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="2" /><path d="m16 16 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
}

function ClipboardIcon() {
  return <svg viewBox="0 0 32 32" fill="none" className="h-8 w-8" aria-hidden><path d="M10 7.5h12v18H10z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M13 7.5V5h6v2.5M14 13h4M14 17h4M14 21h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
}

function DuplicateIcon() {
  return <svg viewBox="0 0 28 28" fill="none" className="h-7 w-7" aria-hidden><rect x="9" y="8" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="2" /><path d="M6 17V6.5A1.5 1.5 0 0 1 7.5 5H18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
}

function MoreIcon() {
  return <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden><circle cx="4" cy="10" r="1.3" /><circle cx="10" cy="10" r="1.3" /><circle cx="16" cy="10" r="1.3" /></svg>;
}

function ClockIcon() {
  return <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5" aria-hidden><circle cx="10" cy="10" r="6" stroke="currentColor" strokeWidth="1.8" /><path d="M10 6.5v3.8l2.5 1.5M6.5 2.8 5.2 4M13.5 2.8 14.8 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>;
}

function OperationalStatus({ incident, sla }: { incident: Incident; sla: ReturnType<typeof slaFor> }) {
  if (sla?.state === "overdue") {
    return <span className="inline-flex items-center gap-1.5 rounded-full bg-[#ffe3e3] px-2.5 py-1 text-xs font-semibold text-[#c52828]"><ClockIcon />Overdue</span>;
  }
  return <span className="inline-flex items-center gap-1.5 rounded-full bg-[#dff6e9] px-2.5 py-1 text-xs font-semibold text-[#167345]"><span className="h-1.5 w-1.5 rounded-full bg-[#15945b]" />{incident.status === "closed" ? "Closed" : "Open"}</span>;
}

function VerificationStatus({ value }: { value: Incident["status"] }) {
  const verified = value === "verified" || value === "community_confirmed" || value === "resolved";
  const rejected = value === "rejected";
  const label = verified ? "Verified" : rejected ? "Rejected" : "Pending";
  const cls = verified ? "bg-[#dff6e9] text-[#167345]" : rejected ? "bg-[#ffe3e3] text-[#c52828]" : "bg-[#eef1f4] text-[#536273]";
  return <span className={`inline-flex rounded-md px-2.5 py-1 text-xs font-semibold ${cls}`}>{label}</span>;
}

function SeverityPill({ value }: { value: Severity }) {
  const cls: Record<Severity, string> = {
    critical: "bg-[#ffe3e3] text-[#c52828]",
    high: "bg-[#ffecd0] text-[#c45a05]",
    medium: "bg-[#fff1c8] text-[#a36a00]",
    low: "bg-[#eef1f4] text-[#536273]",
  };
  return <span className={`inline-flex rounded-md px-2.5 py-1 text-xs font-semibold capitalize ${cls[value]}`}>{value}</span>;
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

function QueuePageSkeleton() {
  return (
    <div className="mx-auto max-w-[1500px] space-y-6 pb-10" style={FONT} aria-label="Loading incidents">
      <div className="space-y-2"><div className="h-3 w-28 animate-pulse rounded bg-zinc-200" /><div className="h-9 w-48 animate-pulse rounded bg-zinc-200" /><div className="h-4 w-[min(42rem,85%)] animate-pulse rounded bg-zinc-100" /></div>
      <Card className="space-y-3"><div className="h-10 w-full animate-pulse rounded bg-zinc-100" /><div className="h-4 w-48 animate-pulse rounded bg-zinc-100" /></Card>
      <SkeletonRows />
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
    <Suspense fallback={<QueuePageSkeleton />}>
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
    placeholderData: keepPreviousData,
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
    if (updates.queue && updates.queue !== "open") next.assignee_id = "";
    if (updates.assignee_id) next.queue = "open";
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
  }, [scope.q, scope.status, scope.severity, scope.queue, scope.assignee_id, scope.window_days, scope.state, scope.sla, scope.sort, scope.page]);

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
    ? (["verified", "rejected"] as const).filter((status) =>
        selectedRows.every((row) => row.allowed_statuses?.includes(status)),
      )
    : [];
  const pageSelected = rows.length > 0 && rows.every((row) => selected[row.id]);
  const hasScope = !!scope.q || !!scope.status || !!scope.severity || scope.queue !== "open" || !!scope.assignee_id || !!scope.window_days || !!scope.state || !!scope.sla || scope.sort !== "newest" || scope.page > 1;
  const total = data?.total ?? 0;
  const totalPages = data?.total_pages ?? 0;
  const firstResult = total === 0 ? 0 : (scope.page - 1) * INCIDENT_PAGE_SIZE + 1;
  const lastResult = total === 0 ? 0 : Math.min(scope.page * INCIDENT_PAGE_SIZE, total);
  const selectedAssignee = scope.assignee_id ? staffById.get(scope.assignee_id) : undefined;
  const queueTitle = selectedAssignee
    ? `${staffName(selectedAssignee.email, selectedAssignee.id)}’s queue`
    : scope.queue === "mine"
      ? "My queue"
      : scope.queue === "unassigned"
        ? "Unassigned"
        : "All open";
  const returnTo = `${pathname}${incidentScopeQuery(scope, false)}`;

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["admin-incidents"] });
    qc.invalidateQueries({ queryKey: ["admin-recent"] });
    qc.invalidateQueries({ queryKey: ["admin-duplicates"] });
    qc.invalidateQueries({ queryKey: ["admin-staff"] });
    qc.invalidateQueries({ queryKey: ["admin-staff-workspace"] });
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
    assignee_id: scope.assignee_id || null,
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
    if (key === "q" || key === "status" || key === "severity" || key === "state" || key === "sla") replaceScope({ [key]: "", page: 1 });
    else if (key === "queue") replaceScope({ queue: "open", assignee_id: "", page: 1 });
    else if (key === "window_days") replaceScope({ window_days: null, page: 1 });
    else if (key === "sort") replaceScope({ sort: "newest", page: 1 });
    else if (key === "assignee_id") replaceScope({ assignee_id: "", page: 1 });
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
    <div className="mx-auto max-w-[1500px] space-y-4 pb-10" style={FONT}>
      <section className="flex items-start justify-between gap-5" aria-labelledby="incidents-heading">
        <div className="flex min-w-0 items-start gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-[#edf1f3] text-[#142b35]">
            <ClipboardIcon />
          </div>
          <div className="min-w-0 pt-0.5">
            <div className="flex flex-wrap items-center gap-3">
              <h1 id="incidents-heading" className="text-[30px] font-bold leading-none tracking-[-0.04em] text-[#101d2e]">{queueTitle}</h1>
              <span className="rounded-full bg-[#e9efec] px-3 py-1 text-xs font-semibold text-[#22352b]">{total} incidents</span>
            </div>
            <p className="mt-2 text-sm text-[#516178]">Scan reports, focus the right queue, and move each incident to its next safe action.</p>
          </div>
        </div>
        {(dupes.data ?? []).length > 0 && (
          <NavigationLink href="#duplicates" className="hidden min-w-[292px] items-center gap-3 rounded-xl bg-[#f1eaff] px-5 py-3 text-[#6430d4] transition hover:bg-[#e9deff] focus:outline-none focus:ring-2 focus:ring-[#6f39e7] lg:flex">
            <DuplicateIcon />
            <span className="min-w-0 flex-1"><strong className="block text-sm font-bold">{dupes.data?.length} suspected duplicate pairs</strong><span className="mt-0.5 block text-xs text-[#6a6680]">Review possible duplicates to keep data clean</span></span>
            <span className="text-xl leading-none">›</span>
          </NavigationLink>
        )}
      </section>

      <Card className="!p-3 rounded-xl border-[#e4e8e5] shadow-[0_2px_12px_rgba(18,52,37,0.04)]">
        <div className="grid items-end gap-3 lg:grid-cols-[minmax(260px,1.65fr)_minmax(150px,.72fr)_minmax(165px,.75fr)_minmax(300px,1.2fr)_minmax(160px,.75fr)]">
          <div className="relative min-w-0">
            <label htmlFor="inc-search" className="sr-only">Search incidents</label>
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#405268]"><SearchIcon /></span>
            <Input id="inc-search" placeholder="Search title or description…" value={scope.q} onChange={(event) => replaceScope({ q: event.target.value.slice(0, 100), page: 1 })} className="h-10 rounded-lg border-[#dbe1e3] pl-10 text-sm text-[#1c2b3d] placeholder:text-[#61718a] focus:border-[#2a4a33] focus:ring-[#dce8dc]" />
          </div>
          <label className="min-w-0"><span className="mb-0 block text-[11px] font-medium leading-[13px] text-[#61718a]">Status</span><select id="inc-status" className={`${selectCls} h-10 w-full rounded-lg border-[#dbe1e3] text-sm text-[#1c2b3d]`} value={scope.status} onChange={(event) => replaceScope({ status: event.target.value, page: 1 })}><option value="">All statuses</option>{STATUSES.map((value) => <option key={value} value={value}>{STATUS_LABELS[value]}</option>)}</select></label>
          <label className="min-w-0"><span className="mb-0 block text-[11px] font-medium leading-[13px] text-[#61718a]">Severity</span><select id="inc-sev" className={`${selectCls} h-10 w-full rounded-lg border-[#dbe1e3] text-sm text-[#1c2b3d]`} value={scope.severity} onChange={(event) => replaceScope({ severity: event.target.value, page: 1 })}><option value="">All severities</option>{SEVERITIES.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label className="min-w-0"><span className="mb-0 block text-[11px] font-medium leading-[13px] text-[#61718a]">Queue</span><select id="inc-queue" className={`${selectCls} h-10 w-full rounded-lg border-[#dbe1e3] text-sm text-[#1c2b3d]`} value={scope.queue} onChange={(event) => replaceScope({ queue: event.target.value as typeof scope.queue, page: 1 })}><option value="open">All Open — Every Non-Terminal Incident</option><option value="mine">My queue — open and assigned to you</option><option value="unassigned">Unassigned — open with no owner</option></select></label>
          <label className="min-w-0"><span className="mb-0 block text-[11px] font-medium leading-[13px] text-[#61718a]">Sort</span><select id="inc-sort" className={`${selectCls} h-10 w-full rounded-lg border-[#dbe1e3] text-sm text-[#1c2b3d]`} value={scope.sort} onChange={(event) => replaceScope({ sort: event.target.value as typeof scope.sort, page: 1 })}><option value="newest">Newest First</option><option value="oldest">Oldest first</option><option value="severity">Highest severity</option><option value="action">Needs action</option></select></label>
        </div>
        {(hasScope || isFetching) && <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#eef1ef] pt-3" aria-label="Active incident scope">
          {scope.q && <FilterChip label={`Search: ${scope.q}`} onRemove={() => clearOne("q")} />}
          {scope.status && <FilterChip label={`Status: ${labelFor(scope.status)}`} onRemove={() => clearOne("status")} />}
          {scope.severity && <FilterChip label={`Severity: ${scope.severity}`} onRemove={() => clearOne("severity")} />}
          {scope.queue !== "open" && <FilterChip label={`Queue: ${scope.queue === "mine" ? "My queue" : "Unassigned"}`} onRemove={() => clearOne("queue")} />}
          {selectedAssignee && <FilterChip label={`Queue: ${staffName(selectedAssignee.email, selectedAssignee.id)}`} onRemove={() => replaceScope({ assignee_id: "", page: 1 })} />}
          {scope.window_days && <FilterChip label={`Last ${scope.window_days} days`} onRemove={() => clearOne("window_days")} />}
          {scope.state && <FilterChip label={`State: ${scope.state === "needs_attention" ? "Needs attention" : "Resolved"}`} onRemove={() => clearOne("state")} />}
          {scope.sla && <FilterChip label={`SLA: ${scope.sla === "overdue" ? "Overdue" : "Breaching"}`} onRemove={() => clearOne("sla")} />}
          {scope.sort !== "newest" && <FilterChip label={`Sort: ${scope.sort === "action" ? "Needs action" : scope.sort}`} onRemove={() => clearOne("sort")} />}
          {hasScope && <button type="button" onClick={clearAll} className="ml-auto text-xs font-semibold text-[#285e4a] hover:underline focus:outline-none focus:ring-2 focus:ring-[#2a4a33]">Clear all</button>}
          {isFetching && <span className="text-xs font-medium text-[#285e4a]">Updating queue…</span>}
        </div>}
      </Card>

      {selectionMode && selectionCount > 0 && (
        <Card className="space-y-3 border-[#2a4a33] bg-[#f2f6f0]" role="region" aria-label="Bulk actions">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="mr-2 text-sm">{selectionText}</strong>
            {commonBulkStatusActions.map((value) => {
              const label = value === "verified" ? "Approve" : "Reject";
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
      {!isLoading && !error && rows.length === 0 && <FeedbackPanel title="No incidents match this scope" description={hasScope ? "Try removing a filter or clear all to return to All open." : "There are no open incidents in the current queue."} action={hasScope ? <Button onClick={clearAll} className="bg-[#14231a] hover:bg-[#2a4a33]">Clear all</Button> : undefined} />}

      {!isLoading && !error && rows.length > 0 && <section id="duplicates" aria-label="Incident results" aria-busy={isFetching} className={`overflow-hidden rounded-xl border border-[#e0e6e2] bg-white shadow-[0_2px_12px_rgba(18,52,37,0.04)] transition-opacity ${isFetching ? "opacity-70" : ""}`}>
        <div className="flex min-w-[1080px] items-center justify-between border-b border-[#e7ebe9] px-3 py-3 text-xs text-[#5e6d80] sm:px-4">
          <label className="flex items-center gap-3"><input type="checkbox" aria-label={`Select page (${rows.length})`} checked={pageSelected} onChange={(event) => selectPage(event.target.checked)} className="h-[18px] w-[18px] rounded accent-[#2a4a33]" /><span className="font-medium">Select page ({rows.length})</span></label>
          <span aria-live="polite">{isLoading ? "Loading incidents…" : `Showing ${firstResult}–${lastResult} of ${total} incidents`}</span>
        </div>
        <div className="min-w-[1080px]">
          <div className="grid h-8 items-center border-b border-[#e7ebe9] bg-[#fcfdfc] px-3 text-[10px] font-bold uppercase tracking-[0.08em] text-[#5e6d80] sm:px-3 lg:grid-cols-[28px_minmax(300px,1fr)_110px_115px_90px_120px_75px_150px]">
            <span />
            <span className="pl-[3.5rem]">Incident <span className="ml-1 text-[12px]">↕</span></span>
            <span>Status</span>
            <span>Verification</span>
            <span>Severity</span>
            <span>Owner</span>
            <span>Age</span>
            <span>Actions</span>
          </div>
          <div>
            {rows.map((inc) => {
              const src = thumbSrc(inc);
              const location = inc.address ?? `${inc.lat.toFixed(3)}, ${inc.lng.toFixed(3)}`;
              const sla = slaFor(inc.created_at, inc.severity, inc.status);
              const duplicates = dupCount.get(inc.id) ?? [];
              const owner = ownerName(inc.assigned_to);
              const detailHref = `/incidents/${inc.id}?return_to=${encodeURIComponent(returnTo)}`;
              return <article key={inc.id} className={`relative grid min-h-[76px] items-center gap-3 border-b border-[#e7ebe9] px-3 py-2.5 text-sm last:border-b-0 sm:px-5 lg:grid-cols-[28px_minmax(300px,1fr)_110px_115px_90px_120px_75px_150px] ${selected[inc.id] ? "bg-[#f4f8f3]" : "bg-white hover:bg-[#fbfdfb]"}`}>
                <span aria-hidden className={`absolute inset-y-0 left-0 w-[3px] ${SEV_BAR[inc.severity]}`} />
                <input type="checkbox" aria-label={`Select ${inc.title}`} checked={!!selected[inc.id]} onChange={(event) => selectRow(inc.id, event.target.checked)} className="h-[18px] w-[18px] rounded accent-[#2a4a33]" />
                <div className="flex min-w-0 items-center gap-9">
                  <Thumb src={src} />
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2"><NavigationLink href={detailHref} className="truncate font-bold text-[#152033] underline-offset-2 hover:text-[#285e4a] hover:underline focus:outline-none focus:ring-2 focus:ring-[#2a4a33]">{inc.title}</NavigationLink>{duplicates.length > 0 && <span className="shrink-0 rounded-md bg-[#f1eaff] px-1.5 py-0.5 text-[10px] font-bold text-[#6430d4]">{duplicates.length} duplicate{duplicates.length > 1 ? "s" : ""}</span>}</div>
                    <p className="mt-0.5 truncate text-xs text-[#53647a]" title={location}>{location}</p>
                    <p className="truncate text-xs text-[#53647a]" title={inc.description}>{inc.description || "No description provided."}</p>
                  </div>
                </div>
                <OperationalStatus incident={inc} sla={sla} />
                <VerificationStatus value={inc.status} />
                <SeverityPill value={inc.severity} />
                <span className="truncate text-xs text-[#53647a]" title={owner}>{owner}</span>
                <span className="text-xs tabular-nums text-[#53647a]" title={new Date(inc.created_at).toLocaleString()}>{timeAgo(inc.created_at)}</span>
                <div className="flex items-center justify-between gap-2"><NavigationLink href={detailHref} className="whitespace-nowrap text-xs font-semibold text-[#1f664e] underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-[#2a4a33]">Open incident <span aria-hidden>→</span></NavigationLink><button type="button" aria-label={`More actions for ${inc.title}`} className="rounded p-1 text-[#1f3445] hover:bg-[#edf3ee] focus:outline-none focus:ring-2 focus:ring-[#2a4a33]"><MoreIcon /></button></div>
              </article>;
            })}
          </div>
        </div>
      </section>}

      {!isLoading && !error && totalPages > 0 && <nav aria-label="Incident pages" className="flex flex-wrap items-center justify-between gap-4 pt-1 text-sm text-[#5e6d80]"><div className="flex items-center gap-2"><button type="button" disabled={scope.page <= 1} onClick={() => replaceScope({ page: scope.page - 1 })} className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#e1e7e3] bg-white px-3 font-medium text-[#6b7a8c] transition hover:bg-[#f3f7f4] disabled:cursor-not-allowed disabled:opacity-45 focus:outline-none focus:ring-2 focus:ring-[#2a4a33]">← <span>Previous</span></button><div className="flex items-center gap-1">{Array.from({ length: Math.min(totalPages, 5) }, (_, index) => index + 1).map((page) => <button key={page} type="button" onClick={() => replaceScope({ page })} className={`h-10 min-w-10 rounded-lg px-3 font-semibold ${scope.page === page ? "bg-[#164533] text-white" : "text-[#1e2e42] hover:bg-[#edf3ee]"}`}>{page}</button>)}{totalPages > 6 && <span className="px-1">…</span>}{totalPages > 5 && <button type="button" onClick={() => replaceScope({ page: totalPages })} className={`h-10 min-w-10 rounded-lg px-3 font-semibold ${scope.page === totalPages ? "bg-[#164533] text-white" : "text-[#1e2e42] hover:bg-[#edf3ee]"}`}>{totalPages}</button>}</div><button type="button" disabled={scope.page >= totalPages} onClick={() => replaceScope({ page: scope.page + 1 })} className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#e1e7e3] bg-[#edf2ee] px-3 font-medium text-[#19352a] transition hover:bg-[#e4eee6] disabled:cursor-not-allowed disabled:opacity-45 focus:outline-none focus:ring-2 focus:ring-[#2a4a33]"><span>Next</span> →</button></div><label className="flex items-center gap-3">Rows per page <select aria-label="Rows per page" value={INCIDENT_PAGE_SIZE} disabled className="h-10 rounded-lg border border-[#e1e7e3] bg-white px-3 font-medium text-[#1e2e42]"><option value={INCIDENT_PAGE_SIZE}>{INCIDENT_PAGE_SIZE}</option></select></label></nav>}
      {toast && <div role="status" className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm text-white shadow-lg">{bulk.isPending ? "Applying…" : toast}</div>}
    </div>
  );
}
