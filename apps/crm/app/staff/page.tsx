"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { StaffMember, StaffWorkspace, StaffUser } from "@/lib/types";
import { staffName } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { FeedbackPanel } from "@/components/ui/feedback-panel";
import { NavigationLink } from "@/components/ui/navigation-link";

const FONT = { fontFamily: "Verdana, Geneva, sans-serif" } as const;
type SortMode = "name" | "workload" | "activity";

const STATUS_COLOR: Record<string, string> = {
  available: "bg-[#e4f5eb] text-[#167345]",
  busy: "bg-[#fff1d8] text-[#a36a00]",
  away: "bg-[#eef1f4] text-[#536273]",
};

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "No recorded activity";
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}d ago` : new Date(iso).toLocaleDateString();
}

function PeopleIcon({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <circle cx="16" cy="10" r="4.2" stroke="currentColor" strokeWidth="1.9" />
      <path d="M8.5 25c.7-4.1 3.2-6.2 7.5-6.2s6.8 2.1 7.5 6.2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M7 15.2a3.6 3.6 0 0 0-3.8 3.5M25 15.2a3.6 3.6 0 0 1 3.8 3.5M3.8 25c.4-2.2 1.5-3.7 3.4-4.4M28.2 25c-.4-2.2-1.5-3.7-3.4-4.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function MetricIcon({ kind }: { kind: "active" | "workload" | "unassigned" | "all" }) {
  const paths = {
    active: <><circle cx="12" cy="9" r="3" /><path d="M6.5 20c.5-3.2 2.3-4.8 5.5-4.8s5 1.6 5.5 4.8" /><path d="M18 11a3 3 0 0 1 4.5 2.6M20 20c-.2-1.6-.8-2.8-1.9-3.6" /></>,
    workload: <><path d="M8 3.5h8l4 4V21H8z" /><path d="M16 3.5V8h4M11 12h6M11 16h6" /></>,
    unassigned: <><circle cx="16" cy="16" r="7" /><path d="M16 12v4l2.5 2" /><path d="M16 5V3M23.7 8.3l1.4-1.4" /></>,
    all: <><path d="M7 7h2M12 7h11M7 13h2M12 13h11M7 19h2M12 19h11" /><circle cx="5" cy="7" r=".8" /><circle cx="5" cy="13" r=".8" /><circle cx="5" cy="19" r=".8" /></>,
  };
  return <svg viewBox="0 0 32 32" fill="none" className="h-7 w-7" aria-hidden="true" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[kind]}</svg>;
}

function SearchIcon() {
  return <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5" aria-hidden="true"><circle cx="8.7" cy="8.7" r="5.4" stroke="currentColor" strokeWidth="1.8" /><path d="m13 13 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
}

function ChevronDown() {
  return <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function InfoIcon() {
  return <svg viewBox="0 0 18 18" fill="none" className="h-4 w-4 shrink-0" aria-hidden="true"><circle cx="9" cy="9" r="6.2" stroke="currentColor" strokeWidth="1.5" /><path d="M9 8v4M9 5.5v.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>;
}

function ListIcon() {
  return <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true"><path d="M8 5h9M8 10h9M8 15h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><circle cx="4" cy="5" r="1" fill="currentColor" /><circle cx="4" cy="10" r="1" fill="currentColor" /><circle cx="4" cy="15" r="1" fill="currentColor" /></svg>;
}

function GridIcon() {
  return <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true"><rect x="3" y="3" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.6" /><rect x="12" y="3" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.6" /><rect x="3" y="12" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.6" /><rect x="12" y="12" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.6" /></svg>;
}

function KebabMenu({ member }: { member: StaffMember }) {
  const name = staffName(member.email, member.id);
  return (
    <details className="relative">
      <summary aria-label={`More actions for ${name}`} title={`More actions for ${name}`} className="flex h-10 w-8 cursor-pointer list-none items-center justify-center rounded-lg text-[#142b35] transition hover:bg-[#eef2f0] focus:outline-none focus:ring-2 focus:ring-[#2a4a33] [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="text-2xl leading-none tracking-[0.15em]">···</span>
      </summary>
      <div className="absolute right-0 top-11 z-10 w-44 rounded-xl border border-[#dfe5dd] bg-white p-1.5 shadow-[0_12px_30px_rgba(20,35,26,0.14)]">
        <NavigationLink href={`/incidents?queue=open&assignee_id=${encodeURIComponent(member.id)}`} className="block rounded-lg px-3 py-2 text-left text-xs font-semibold text-[#14231a] hover:bg-[#f1f6ef]">Open queue</NavigationLink>
        <button type="button" onClick={() => void navigator.clipboard?.writeText(member.email)} className="block w-full rounded-lg px-3 py-2 text-left text-xs font-semibold text-[#14231a] hover:bg-[#f1f6ef]">Copy email</button>
      </div>
    </details>
  );
}

function StaffRow({ member, currentId, canOverride, onAvailability, view }: { member: StaffMember; currentId?: string; canOverride: boolean; onAvailability: (id: string, availability: string) => void; view: "list" | "grid" }) {
  const availability = member.availability ?? "available";
  const canChange = canOverride || member.id === currentId;
  const name = staffName(member.email, member.id);
  const roleLabel = member.role ? member.role[0].toUpperCase() + member.role.slice(1) : "Staff";
  return (
    <article className={view === "list" ? "border-b border-[#e2e6df] py-7" : "rounded-2xl border border-[#e2e6df] bg-white p-5 shadow-[0_4px_18px_rgba(20,35,26,0.04)]"}>
      <div className={view === "list" ? "grid items-center gap-x-6 gap-y-5 lg:grid-cols-[minmax(330px,1.45fr)_minmax(160px,.75fr)_minmax(170px,.75fr)_minmax(190px,1fr)_auto_auto]" : "space-y-5"}>
        <div className="flex min-w-0 items-center gap-6">
          <span className="flex h-[70px] w-[70px] shrink-0 items-center justify-center rounded-full bg-[#e0eee7] text-[22px] font-bold text-[#155b4b]">{name.slice(0, 2).toUpperCase()}</span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-[18px] font-bold tracking-[-0.02em] text-[#101d2e]">{name}</h3>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${member.id === currentId ? "bg-[#e7f4ec] text-[#347457]" : member.role === "admin" ? "bg-[#f0dcff] text-[#7138b8]" : "bg-[#eef1f4] text-[#536273]"}`}>{member.id === currentId ? "You" : roleLabel}</span>
            </div>
            <p className="mt-2 truncate text-sm text-[#61718a]">{member.email}</p>
          </div>
        </div>

        <div className="border-l border-[#e2e6df] pl-6">
          <p className="flex items-center gap-2 text-sm text-[#61718a]"><PeopleIcon className="h-4 w-4" />Availability</p>
          <div className="mt-3 flex items-center gap-3">
            <span className={`h-3.5 w-3.5 rounded-full ${availability === "available" ? "bg-[#14945d]" : availability === "busy" ? "bg-[#e4a11b]" : "bg-[#aab4bd]"}`} />
            {canChange ? <label className={`relative inline-flex items-center gap-3 rounded-full px-3.5 py-2 text-sm font-bold capitalize ${STATUS_COLOR[availability] ?? STATUS_COLOR.available}`}><span>{availability}</span><select aria-label={`Availability for ${name}`} value={availability} onChange={(event) => onAvailability(member.id, event.target.value)} className="absolute inset-0 cursor-pointer opacity-0"><option value="available">Available</option><option value="busy">Busy</option><option value="away">Away</option></select><ChevronDown /></label> : <span className={`inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-bold capitalize ${STATUS_COLOR[availability] ?? STATUS_COLOR.available}`}>{availability}</span>}
          </div>
        </div>

        <div className="border-l border-[#e2e6df] pl-6">
          <p className="flex items-center gap-2 text-sm text-[#61718a]"><svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true"><path d="M5 3h7l3 3v11H5zM12 3v4h3M8 11h4M8 14h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>Open assignments</p>
          <p className="mt-3 text-[19px] font-bold tabular-nums text-[#101d2e]">{member.open_count}</p>
        </div>

        <div className="border-l border-[#e2e6df] pl-6">
          <p className="flex items-center gap-2 text-sm text-[#61718a]"><svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true"><circle cx="10" cy="10" r="6.5" stroke="currentColor" strokeWidth="1.6" /><path d="M10 6.5V10l2.5 1.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>Last activity</p>
          <p className="mt-3 text-[17px] font-medium text-[#101d2e]">{timeAgo(member.last_active_at)}</p>
        </div>

        <NavigationLink href={`/incidents?queue=open&assignee_id=${encodeURIComponent(member.id)}`} className="inline-flex h-[46px] items-center justify-center gap-3 whitespace-nowrap rounded-lg bg-[#0d4a3a] px-5 text-sm font-bold text-white transition hover:bg-[#14614d] focus:outline-none focus:ring-2 focus:ring-[#2a4a33] focus:ring-offset-2">View queue <span aria-hidden className="text-lg leading-none">→</span></NavigationLink>
        <KebabMenu member={member} />
      </div>
      <p className="mt-6 flex items-center gap-2 pl-1 text-sm text-[#61718a]"><InfoIcon />Busy and Away staff can still receive queued work.</p>
    </article>
  );
}

export default function StaffPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortMode>("name");
  const [view, setView] = useState<"list" | "grid">("list");
  const workspace = useQuery({ queryKey: ["admin-staff-workspace"], queryFn: () => apiFetch<StaffWorkspace>("/admin/staff/workspace") });
  const me = useQuery({ queryKey: ["admin-me"], queryFn: () => apiFetch<StaffUser>("/admin/me"), retry: false });
  const availability = useMutation({ mutationFn: ({ id, value }: { id: string; value: string }) => apiFetch(`/admin/staff/${id}/availability`, { method: "PATCH", body: JSON.stringify({ availability: value }) }), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-staff-workspace"] }) });
  const data = workspace.data;
  const currentId = me.data?.id;
  const isAdmin = me.data?.role === "admin";
  const members = useMemo(() => {
    const query = search.trim().toLowerCase();
    return [...(data?.members ?? [])]
      .filter((member) => !query || `${staffName(member.email, member.id)} ${member.email}`.toLowerCase().includes(query))
      .sort((a, b) => sort === "workload" ? b.open_count - a.open_count : sort === "activity" ? new Date(b.last_active_at ?? 0).getTime() - new Date(a.last_active_at ?? 0).getTime() : staffName(a.email, a.id).localeCompare(staffName(b.email, b.id)));
  }, [data?.members, search, sort]);
  const allOpen = (data?.total_open_workload ?? 0) + (data?.unassigned_open ?? 0);
  const metrics = [
    { label: "Active staff", value: data?.active_staff ?? 0, detail: "Available or Busy", kind: "active" as const, tone: "bg-[#e6f5ed] text-[#16815a]" },
    { label: "Open workload", value: data?.total_open_workload ?? 0, detail: "Assigned, non-terminal incidents", kind: "workload" as const, tone: "bg-[#f2f5f8] text-[#1d4e9a]" },
    { label: "Unassigned", value: data?.unassigned_open ?? 0, detail: "Open incidents needing an owner", kind: "unassigned" as const, tone: "bg-[#fff3e3] text-[#e47212]" },
    { label: "All open", value: allOpen, detail: "Every non-terminal incident", kind: "all" as const, tone: "bg-[#f2f5f8] text-[#34495e]" },
  ];

  return (
    <div className="mx-auto max-w-[1500px] px-4 pb-12 lg:ml-[17px] lg:mr-[14px] lg:px-0" style={FONT}>
      <section className="flex items-start justify-between gap-8 pt-4 lg:pl-3">
        <div className="flex min-w-0 items-start gap-6">
          <div className="mt-1 flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#eef2f0] text-[#142b35]"><PeopleIcon className="h-9 w-9" /></div>
          <div className="min-w-0">
            <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-[#61718a]">Manage operations</p>
            <h1 className="mt-2 text-[36px] font-bold leading-none tracking-[-0.045em] text-[#101d2e]">Staff</h1>
            <p className="mt-4 max-w-[650px] text-[15px] leading-6 text-[#61718a]">See team coverage, workload, and the exact queues each person owns.<br />Use availability as a coordination signal. It never blocks a deliberate assignment.</p>
          </div>
        </div>
        <div className="hidden shrink-0 items-center gap-3 pt-10 text-[15px] text-[#61718a] sm:flex"><PeopleIcon className="h-6 w-6 text-[#142b35]" /><span>{data?.total_staff ?? 0} staff members</span></div>
      </section>

      <div className="mt-6 border-t border-[#e2e6df]" />

      {workspace.isLoading && <div className="mt-8 grid gap-6 sm:grid-cols-4" aria-label="Loading staff workspace">{metrics.map((metric) => <div key={metric.label} className="h-24 animate-pulse rounded-xl bg-[#f0f2ee]" />)}</div>}
      {workspace.error && !workspace.isLoading && <div className="mt-8"><FeedbackPanel variant="error" title="Staff workspace could not load" description={(workspace.error as Error).message} action={<Button onClick={() => workspace.refetch()}>Retry</Button>} /></div>}

      {!workspace.isLoading && !workspace.error && data && <>
        <section aria-label="Staff workload summary" className="grid gap-0 py-6 sm:grid-cols-2 lg:grid-cols-4">
          {metrics.map((metric, index) => <div key={metric.label} className={`flex items-start gap-6 py-2 lg:px-6 ${index === 0 ? "lg:pl-2" : "border-l border-[#e2e6df]"}`}><span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${metric.tone}`}><MetricIcon kind={metric.kind} /></span><div className="min-w-0"><p className="text-[30px] font-bold leading-none tracking-[-0.04em] text-[#101d2e]">{metric.value}</p><p className="mt-2 text-[16px] font-bold text-[#435168]">{metric.label}</p><p className="mt-1 text-[14px] leading-5 text-[#61718a] lg:whitespace-nowrap">{metric.detail}</p></div></div>)}
        </section>

        <div className="border-t border-[#e2e6df]" />

        <section aria-label="Staff members" className="pt-7">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e2e6df] pb-6">
            <h2 className="text-[26px] font-bold tracking-[-0.035em] text-[#101d2e]">Staff members ({data.total_staff})</h2>
            <div className="flex flex-wrap items-center gap-5">
              <label className="relative block w-[358px] max-w-full"><span className="sr-only">Search staff by name or email</span><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#61718a]"><SearchIcon /></span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search staff by name or email..." className="h-11 w-full rounded-lg border border-[#dbe1e3] bg-white pl-11 pr-4 text-sm text-[#1c2b3d] outline-none transition focus:border-[#2a4a33] focus:ring-2 focus:ring-[#dce8dc]" /></label>
              <span className="text-sm text-[#61718a]">Sort by</span>
              <label className="relative"><span className="sr-only">Sort staff</span><select value={sort} onChange={(event) => setSort(event.target.value as SortMode)} className="h-11 w-[157px] appearance-none rounded-lg border border-[#dbe1e3] bg-white px-4 pr-9 text-sm font-semibold text-[#1c2b3d] outline-none focus:border-[#2a4a33] focus:ring-2 focus:ring-[#dce8dc]"><option value="name">Name (A–Z)</option><option value="workload">Open workload</option><option value="activity">Last activity</option></select><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#61718a]"><ChevronDown /></span></label>
              <div className="flex h-11 overflow-hidden rounded-lg border border-[#edf0ed] bg-[#f4f6f3] p-0.5"><button type="button" aria-label="Grid view" aria-pressed={view === "grid"} onClick={() => setView("grid")} className={`flex w-12 items-center justify-center rounded-md ${view === "grid" ? "bg-white text-[#142b35] shadow-sm" : "text-[#61718a]"}`}><GridIcon /></button><button type="button" aria-label="List view" aria-pressed={view === "list"} onClick={() => setView("list")} className={`flex w-12 items-center justify-center rounded-md ${view === "list" ? "bg-[#0d4a3a] text-white shadow-sm" : "text-[#61718a]"}`}><ListIcon /></button></div>
            </div>
          </div>

          {members.length === 0 ? <div className="py-10"><FeedbackPanel title={search ? "No staff match that search" : "No staff members found"} description={search ? "Try a different name or email." : isAdmin ? "Invite your first operations staff member to make assignment coverage visible." : "An administrator needs to invite an operations staff member before work can be assigned."} action={!search && isAdmin ? <NavigationLink href="/staff/invite" className="inline-flex items-center justify-center rounded-lg bg-[#0d4a3a] px-4 py-2 text-sm font-bold text-white">Invite staff</NavigationLink> : undefined} /></div> : <div className={view === "list" ? "" : "grid gap-5 lg:grid-cols-2"}>{members.map((member) => <StaffRow key={member.id} member={member} currentId={currentId} canOverride={isAdmin} onAvailability={(id, value) => availability.mutate({ id, value })} view={view} />)}</div>}
          {availability.error && <p role="alert" className="mt-4 text-sm text-red-700">Availability update failed: {(availability.error as Error).message}</p>}
        </section>
      </>}
    </div>
  );
}
