"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { StaffMember, StaffWorkspace, StaffUser } from "@/lib/types";
import { staffName } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FeedbackPanel } from "@/components/ui/feedback-panel";
import { PageHeader } from "@/components/ui/page-header";
import { NavigationLink } from "@/components/ui/navigation-link";

const FONT = { fontFamily: "Verdana, Geneva, sans-serif" } as const;
const ROLE_COLOR: Record<string, string> = { admin: "bg-purple-100 text-purple-800", dispatcher: "bg-blue-100 text-blue-800", analyst: "bg-green-100 text-green-800" };
const STATUS_COLOR: Record<string, string> = { available: "bg-emerald-100 text-emerald-800", busy: "bg-amber-100 text-amber-800", away: "bg-zinc-100 text-zinc-700" };

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

function QueueLink({ href, label, count, detail }: { href: string; label: string; count: number; detail: string }) {
  return <NavigationLink href={href} className="group block rounded-xl border border-zinc-200 bg-white p-4 transition hover:-translate-y-0.5 hover:border-[#9bbb91] hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-[#2a4a33]"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-zinc-900">{label}</p><p className="mt-1 text-xs leading-5 text-zinc-500">{detail}</p></div><span className="text-2xl font-semibold tabular-nums text-[#285e4a]">{count}</span></div><span className="mt-3 block text-xs font-semibold text-[#285e4a] group-hover:underline">Open queue →</span></NavigationLink>;
}

function StaffCard({ member, currentId, canOverride, onAvailability }: { member: StaffMember; currentId?: string; canOverride: boolean; onAvailability: (id: string, availability: string) => void }) {
  const availability = member.availability ?? "available";
  const canChange = canOverride || member.id === currentId;
  const name = staffName(member.email, member.id);
  return <Card className="space-y-4 p-4 sm:p-5"><div className="flex items-start gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#dce8dc] text-sm font-bold text-[#285e4a]">{name.slice(0, 2).toUpperCase()}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate font-semibold text-zinc-900">{name}</h2>{member.id === currentId && <span className="rounded-full bg-[#f2f6f0] px-2 py-0.5 text-[11px] font-semibold text-[#285e4a]">You</span>}</div><p className="truncate text-xs text-zinc-500">{member.email}</p></div><span className={`rounded-full px-2 py-1 text-xs font-semibold capitalize ${ROLE_COLOR[member.role] ?? "bg-zinc-100 text-zinc-700"}`}>{member.role}</span></div><div className="grid gap-3 sm:grid-cols-3"><div><p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Availability</p>{canChange ? <select aria-label={`Availability for ${name}`} value={availability} onChange={(event) => onAvailability(member.id, event.target.value)} className={`mt-1 rounded-md border-0 px-2 py-1 text-xs font-semibold capitalize outline-none ring-1 ring-inset ring-zinc-200 focus:ring-2 focus:ring-[#2a4a33] ${STATUS_COLOR[availability]}`}><option value="available">Available</option><option value="busy">Busy</option><option value="away">Away</option></select> : <span className={`mt-1 inline-block rounded-full px-2 py-1 text-xs font-semibold capitalize ${STATUS_COLOR[availability]}`}>{availability}</span>}</div><div><p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Open assignments</p><p className="mt-1 text-lg font-semibold tabular-nums text-zinc-900">{member.open_count}</p></div><div><p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Last activity</p><p className="mt-1 text-sm text-zinc-700">{timeAgo(member.last_active_at)}</p></div></div><div className="flex items-center justify-between gap-3 border-t border-zinc-100 pt-3"><span className="text-xs text-zinc-500">Busy and Away staff can still receive queued work.</span><NavigationLink href={`/incidents?queue=open&assignee_id=${encodeURIComponent(member.id)}`} className="shrink-0 text-sm font-semibold text-[#285e4a] hover:underline focus:outline-none focus:ring-2 focus:ring-[#2a4a33]">View queue →</NavigationLink></div></Card>;
}

export default function StaffPage() {
  const qc = useQueryClient();
  const workspace = useQuery({ queryKey: ["admin-staff-workspace"], queryFn: () => apiFetch<StaffWorkspace>("/admin/staff/workspace") });
  const me = useQuery({ queryKey: ["admin-me"], queryFn: () => apiFetch<StaffUser>("/admin/me"), retry: false });
  const availability = useMutation({ mutationFn: ({ id, value }: { id: string; value: string }) => apiFetch(`/admin/staff/${id}/availability`, { method: "PATCH", body: JSON.stringify({ availability: value }) }), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-staff-workspace"] }) });
  const data = workspace.data;
  const members = data?.members ?? [];
  const currentId = me.data?.id;
  const isAdmin = me.data?.role === "admin";
  const summary = useMemo(() => [{ label: "Active staff", value: data?.active_staff ?? 0, detail: "Available or Busy" }, { label: "Open workload", value: data?.total_open_workload ?? 0, detail: "Assigned, non-terminal incidents" }, { label: "Unassigned", value: data?.unassigned_open ?? 0, detail: "Open incidents needing an owner" }], [data]);

  return <div className="mx-auto max-w-[1500px] space-y-6 pb-10" style={FONT}><PageHeader eyebrow="Manage operations" title="Staff" description="See team coverage, workload, and the exact queues each person owns." meta={<span aria-live="polite">{workspace.isLoading ? "Loading workspace…" : `${data?.total_staff ?? 0} staff member${(data?.total_staff ?? 0) === 1 ? "" : "s"}`}</span>} /><div className="flex flex-wrap items-center justify-between gap-3"><p className="max-w-2xl text-sm leading-6 text-zinc-600">Use availability as a coordination signal. It never blocks a deliberate assignment.</p>{isAdmin && <NavigationLink href="/staff/invite" className="inline-flex items-center justify-center rounded-md bg-[#14231a] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#2a4a33] focus:outline-none focus:ring-2 focus:ring-[#2a4a33] focus:ring-offset-2">Invite staff</NavigationLink>}</div>{workspace.isLoading && <div className="grid gap-3 sm:grid-cols-3" aria-label="Loading staff workspace">{[0, 1, 2].map((item) => <Card key={item} className="h-24 animate-pulse bg-zinc-100" />)}</div>}{workspace.error && !workspace.isLoading && <FeedbackPanel variant="error" title="Staff workspace could not load" description={(workspace.error as Error).message} action={<Button onClick={() => workspace.refetch()}>Retry</Button>} />}{!workspace.isLoading && !workspace.error && data && <><div className="grid gap-3 sm:grid-cols-3">{summary.map((item) => <Card key={item.label} className="p-4"><p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{item.label}</p><p className="mt-2 text-3xl font-semibold tabular-nums text-zinc-900">{item.value}</p><p className="mt-1 text-xs text-zinc-500">{item.detail}</p></Card>)}</div><div className="grid gap-3 lg:grid-cols-3" aria-label="Operational queues"><QueueLink href="/incidents?queue=open" label="All open" count={data.total_open_workload + data.unassigned_open} detail="Every non-terminal incident" /><QueueLink href="/incidents?queue=mine" label="My queue" count={members.find((member) => member.id === currentId)?.open_count ?? 0} detail="Open work assigned to you" /><QueueLink href="/incidents?queue=unassigned" label="Unassigned" count={data.unassigned_open} detail="Open work without an owner" /></div>{members.length === 0 ? <FeedbackPanel title="No staff members found" description={isAdmin ? "Invite your first operations staff member to make assignment coverage visible." : "An administrator needs to invite an operations staff member before work can be assigned."} action={isAdmin ? <NavigationLink href="/staff/invite" className="inline-flex items-center justify-center rounded-md bg-[#14231a] px-4 py-2 text-sm font-medium text-white">Invite staff</NavigationLink> : undefined} /> : <section aria-label="Staff members" className="grid gap-3 lg:grid-cols-2">{members.map((member) => <StaffCard key={member.id} member={member} currentId={currentId} canOverride={isAdmin} onAvailability={(id, value) => availability.mutate({ id, value })} />)}</section>}{availability.error && <p role="alert" className="text-sm text-red-700">Availability update failed: {(availability.error as Error).message}</p>}</>}</div>;
}
