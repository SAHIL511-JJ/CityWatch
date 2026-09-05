"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, getApiBase, getToken } from "@/lib/api";
import type { AppUser, IncidentDetail, Severity, StatusHistoryEntry } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { IncidentMiniMap } from "@/components/map";

const FONT = { fontFamily: "Verdana, Geneva, sans-serif" } as const;

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 text-sm font-semibold tracking-wide text-zinc-500">{children}</h2>;
}

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

const DOT: Record<string, string> = {
  verified: "bg-green-500",
  rejected: "bg-red-500",
  escalated: "bg-purple-500",
  resolved: "bg-blue-500",
  closed: "bg-zinc-400",
  processing: "bg-yellow-500",
  needs_review: "bg-orange-500",
  created: "bg-zinc-300",
};

const ACTION_STYLE: Record<string, string> = {
  verified: "bg-green-700 text-white hover:bg-green-600",
  rejected: "bg-white text-red-700 ring-1 ring-inset ring-red-300 hover:bg-red-50",
  escalated: "bg-amber-600 text-white hover:bg-amber-500",
  resolved: "bg-blue-700 text-white hover:bg-blue-600",
  closed: "bg-transparent text-zinc-500 ring-1 ring-inset ring-zinc-300 hover:bg-zinc-100",
};

const DISABLE_HINT: Record<string, string> = {
  verified: "Already verified — pick another action to change status",
  rejected: "Already rejected",
  escalated: "Already escalated",
  resolved: "Already resolved",
  closed: "Already closed",
};

function initialsOf(id: string | null | undefined): string {
  if (!id) return "SY";
  const s = id.replace(/-/g, "");
  return (s.slice(0, 2) || "SY").toUpperCase();
}

type CollapsedGroup = { key: string; entries: StatusHistoryEntry[]; count: number };

function collapseHistory(list: StatusHistoryEntry[]): CollapsedGroup[] {
  const groups: CollapsedGroup[] = [];
  for (const h of list) {
    const last = groups[groups.length - 1];
    const lastEntry = last?.entries[last.entries.length - 1];
    if (
      last &&
      lastEntry &&
      lastEntry.old_status === h.old_status &&
      lastEntry.new_status === h.new_status
    ) {
      last.entries.push(h);
      last.count += 1;
    } else {
      groups.push({ key: h.id, entries: [h], count: 1 });
    }
  }
  return groups;
}

export default function IncidentDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [severity, setSeverity] = useState<Severity | "">("");
  const [assignee, setAssignee] = useState("");
  const [zoom, setZoom] = useState(false);
  const [photoOk, setPhotoOk] = useState(true);
  const [confirming, setConfirming] = useState<"rejected" | "closed" | null>(null);
  const [reason, setReason] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [hideNoops, setHideNoops] = useState(true);
  const [toast, setToast] = useState<{ msg: string; undo: () => void } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  // reset local edits when switching incidents
  useEffect(() => {
    setNote("");
    setSeverity("");
    setAssignee("");
    setZoom(false);
    setPhotoOk(true);
    setConfirming(null);
    setReason("");
    setExpandedGroups({});
    setToast(null);
  }, [id]);

  // Esc closes the lightbox
  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoom(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);

  // Toast auto-dismiss
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-incident", id],
    queryFn: () => apiFetch<IncidentDetail>(`/admin/incidents/${id}`),
  });

  const staffList = useQuery({
    queryKey: ["admin-users-assign"],
    queryFn: () => apiFetch<AppUser[]>("/admin/users"),
    retry: false,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-incident", id] });

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch(`/admin/incidents/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: refresh,
  });

  const addNote = useMutation({
    mutationFn: (text: string) =>
      apiFetch(`/admin/incidents/${id}/notes`, {
        method: "POST",
        body: JSON.stringify({ note: text }),
      }),
    onSuccess: () => {
      setNote("");
      refresh();
    },
  });

  const historyGroups = useMemo(() => {
    const list = [...(data?.history ?? [])].sort(
      (a, b) => new Date(a.changed_at).getTime() - new Date(b.changed_at).getTime()
    );
    const groups = collapseHistory(list);
    return hideNoops
      ? groups.filter((g) => {
          const e = g.entries[0];
          return !(e.old_status === e.new_status && g.count > 1);
        })
      : groups;
  }, [data?.history, hideNoops]);

  if (isLoading) return <p>Loading…</p>;
  if (error) return <p className="text-red-600">{(error as Error).message}</p>;
  if (!data) return <p>Not found</p>;

  const ai = (data.ai_analysis ?? {}) as Record<string, unknown>;
  const photoSrc = data.photo_url
    ? `${getApiBase()}/admin/incidents/${id}/photo?token=${getToken() ?? ""}`
    : null;
  const rep = data.reporter;
  const hasCoords = typeof data.lat === "number" && typeof data.lng === "number";

  const doStatus = async (status: string, withReason?: string) => {
    const prev = data.status;
    await patch.mutateAsync({ status });
    if (withReason?.trim()) {
      await addNote.mutateAsync(`Status → ${status}: ${withReason.trim()}`);
    }
    setConfirming(null);
    setReason("");
    setToast({
      msg: `Status set to ${status}`,
      undo: () => {
        patch.mutate({ status: prev });
        setToast(null);
      },
    });
  };

  const rerunAnalysis = async () => {
    setAnalyzing(true);
    try {
      await apiFetch(`/admin/incidents/${id}/analyze`, { method: "POST" });
      refresh();
      setToast({ msg: "Analysis re-run complete", undo: () => setToast(null) });
    } catch (e) {
      setToast({
        msg: e instanceof Error ? e.message : "Analysis failed",
        undo: () => setToast(null),
      });
    } finally {
      setAnalyzing(false);
    }
  };

  const saveSeverity = () => {
    if (!severity || severity === data?.severity) return;
    patch.mutate({ severity });
    setToast({
      msg: `Severity set to ${severity}`,
      undo: () => {
        if (data) patch.mutate({ severity: data.severity });
        setToast(null);
      },
    });
  };
  const aiConf =
    typeof data.ai_confidence === "number" ? Math.round(data.ai_confidence * 100) : null;

  return (
    <div className="space-y-5" style={FONT}>
      {/* Header: status first, then title, then context */}
      <div>
        <div className="flex flex-wrap items-center gap-2 capitalize">
          <Badge value={data.status} />
          <Badge value={data.severity} />
          {rep?.verified && <Badge value="verified reporter" />}
        </div>
        <h1 className="mt-2 text-2xl font-bold">{data.title}</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {data.address ?? (hasCoords ? `${data.lat}, ${data.lng}` : "No location")} ·{" "}
          {timeAgo(data.created_at)}{" "}
          <span title={new Date(data.created_at).toLocaleString()}>
            ({new Date(data.created_at).toLocaleString()})
          </span>
          {rep && (
            <>
              {" "}· reported by {rep.email ?? rep.phone ?? rep.device_id ?? "anonymous"}{" "}
              <span
                className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700"
                title={`Reporter trust score ${rep.trust_score}`}
              >
                trust {rep.trust_score}
              </span>
            </>
          )}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        {/* Left: evidence */}
        <div className="space-y-5 lg:col-span-3">
          <Card>
            <SectionTitle>Photo evidence</SectionTitle>
            {photoSrc && photoOk ? (
              <button
                onClick={() => setZoom(true)}
                aria-label="Open photo fullscreen — click to expand"
                className="group relative block w-full cursor-zoom-in overflow-hidden rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2a4a33]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photoSrc}
                  alt="incident photo"
                  onError={() => setPhotoOk(false)}
                  onLoad={(e) => {
                    if (e.currentTarget.naturalWidth <= 8) setPhotoOk(false);
                  }}
                  className="aspect-[16/10] w-full bg-zinc-100 object-cover"
                />
                <span
                  aria-hidden
                  className="absolute inset-0 flex items-center justify-center gap-2 bg-black/0 text-sm font-medium text-white opacity-0 transition group-hover:bg-black/35 group-hover:opacity-100 group-focus-visible:bg-black/35 group-focus-visible:opacity-100"
                >
                  <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
                    <path d="M12 3.5H16.5V8M16.5 3.5L11 9M8 16.5H3.5V12M3.5 16.5L9 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Click to expand
                </span>
              </button>
            ) : (
              <div className="flex aspect-[16/10] w-full flex-col items-center justify-center gap-2 rounded-xl bg-zinc-100 text-zinc-400">
                <svg viewBox="0 0 24 24" fill="none" className="h-10 w-10" aria-hidden>
                  <rect x="3" y="5" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" />
                  <circle cx="8.5" cy="10.5" r="1.8" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M4.5 16.5l4.5-4.5 3 3 2.5-2.5 5 4" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                </svg>
                <p className="text-sm">No photo attached to this report.</p>
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <p className="flex-1 leading-relaxed">{data.description || "No description provided."}</p>
              <span className="text-xs tabular-nums text-zinc-500" title={new Date(data.created_at).toLocaleString()}>
                {timeAgo(data.created_at)}
              </span>
              {rep && (
                <span
                  className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700"
                  title={`Reporter trust score ${rep.trust_score}`}
                >
                  trust {rep.trust_score}
                </span>
              )}
            </div>
          </Card>

          <Card>
            <SectionTitle>Location</SectionTitle>
            {hasCoords ? (
              <>
                <div className="overflow-hidden rounded-xl">
                  <IncidentMiniMap
                    lat={data.lat}
                    lng={data.lng}
                    severity={data.severity}
                    title={data.title}
                  />
                </div>
                <p className="mt-2 text-xs text-zinc-500">
                  {data.lat}, {data.lng}
                  {data.address ? ` · ${data.address}` : ""}
                </p>
              </>
            ) : (
              <p className="text-sm text-zinc-500">No coordinates on this report.</p>
            )}
          </Card>

          <Card>
            <div className="mb-3 flex items-center gap-3">
              <h2 className="text-sm font-semibold tracking-wide text-zinc-500">AI verdict</h2>
              <button
                onClick={rerunAnalysis}
                disabled={analyzing}
                className="ml-auto inline-flex items-center justify-center rounded-md bg-white px-4 py-2 text-xs font-medium text-zinc-700 ring-1 ring-inset ring-zinc-300 hover:bg-zinc-100 disabled:opacity-50"
              >
                {analyzing && (
                  <svg viewBox="0 0 20 20" fill="none" className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden>
                    <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="2" opacity="0.25" />
                    <path d="M17 10a7 7 0 0 0-7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                )}
                {analyzing ? "Analyzing…" : "Re-run analysis"}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm capitalize">
              <Badge value={String(ai.category ?? "—")} />
              <Badge value={String(ai.severity ?? data.severity)} />
              <span className="text-zinc-600">
                {aiConf !== null ? `${aiConf}% confident` : "Not analyzed yet"}
              </span>
            </div>
            {aiConf !== null && (
              <div
                className="mt-2 h-2 w-full max-w-xs overflow-hidden rounded-full bg-zinc-100"
                role="progressbar"
                aria-valuenow={aiConf}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="AI confidence"
                title={`${aiConf}% confident`}
              >
                <div
                  className={`h-full rounded-full ${aiConf >= 70 ? "bg-green-600" : aiConf >= 40 ? "bg-amber-500" : "bg-red-500"}`}
                  style={{ width: `${aiConf}%` }}
                />
              </div>
            )}
            {typeof ai.reason === "string" && ai.reason ? (
              <p className="mt-2 text-sm leading-relaxed text-zinc-700">{ai.reason}</p>
            ) : (
              <p className="mt-2 text-sm text-zinc-500">
                No AI result — run analysis to get one.
              </p>
            )}
          </Card>
        </div>

        {/* Right: actions + record */}
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <SectionTitle>Moderate</SectionTitle>
            <p className="mb-1 text-xs font-medium text-zinc-500">Set status</p>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["verified", "Approve"],
                  ["rejected", "Reject"],
                  ["escalated", "Escalate"],
                  ["resolved", "Resolve"],
                  ["closed", "Close"],
                ] as const
              ).map(([status, label]) => {
                const disabled = data.status === status || patch.isPending;
                return (
                  <span key={status} title={disabled && data.status === status ? DISABLE_HINT[status] : `${label} this incident`}>
                    <button
                      disabled={disabled}
                      onClick={() =>
                        status === "rejected" || status === "closed"
                          ? setConfirming(status)
                          : doStatus(status)
                      }
                      className={`inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 ${ACTION_STYLE[status]}`}
                    >
                      {label}
                    </button>
                  </span>
                );
              })}
            </div>
            {data.status !== "verified" && data.status !== "closed" && (
              <p className="mt-1.5 text-xs text-zinc-500">
                Current status is <strong className="capitalize">{data.status.replace("_", " ")}</strong> — Approve
                marks it verified.
              </p>
            )}
            {confirming && (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3" role="alertdialog" aria-label={`Confirm ${confirming}`}>
                <p className="text-sm font-medium capitalize text-amber-900">
                  {confirming} this incident?
                </p>
                <Input
                  autoFocus
                  placeholder="Reason (saved to the notes thread)…"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") doStatus(confirming, reason);
                    if (e.key === "Escape") {
                      setConfirming(null);
                      setReason("");
                    }
                  }}
                  className="mt-2 bg-white"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    disabled={patch.isPending}
                    onClick={() => doStatus(confirming, reason)}
                    className="inline-flex items-center justify-center rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50"
                  >
                    Confirm {confirming}
                  </button>
                  <button
                    onClick={() => {
                      setConfirming(null);
                      setReason("");
                    }}
                    className="inline-flex items-center justify-center rounded-md bg-white px-4 py-2 text-sm font-medium text-zinc-700 ring-1 ring-inset ring-zinc-300 hover:bg-zinc-100"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
            <div className="mt-4">
              <label htmlFor="detail-severity" className="mb-1 block text-xs font-medium text-zinc-500">
                Severity · current:{" "}
                <span className="capitalize">
                  <Badge value={data.severity} />
                </span>
              </label>
              <div className="flex gap-2">
                <select
                  id="detail-severity"
                  className="rounded-md border border-zinc-300 px-3 py-2 text-sm capitalize outline-none focus:border-[#2a4a33]"
                  value={severity === "" ? data.severity : severity}
                  onChange={(e) => setSeverity(e.target.value as Severity | "")}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
                <span title={!severity || severity === data.severity ? "Change the severity to enable Save" : "Save new severity"}>
                  <button
                    disabled={!severity || severity === data.severity}
                    onClick={saveSeverity}
                    className="inline-flex items-center justify-center rounded-md bg-[#14231a] px-4 py-2 text-sm font-medium text-white hover:bg-[#2a4a33] disabled:opacity-50"
                  >
                    Save
                  </button>
                </span>
              </div>
            </div>
            <div className="mt-4">
              <label htmlFor="detail-assign" className="mb-1 block text-xs font-medium text-zinc-500">
                Assign to staff
              </label>
              <div className="flex gap-2">
                <select
                  id="detail-assign"
                  className="min-w-0 flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-[#2a4a33]"
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                >
                  <option value="">Select staff…</option>
                  {(staffList.data ?? []).map((u) => (
                    <option key={u.id} value={u.id}>
                      {(u.email ?? u.phone ?? u.device_id ?? u.id).slice(0, 32)}
                    </option>
                  ))}
                </select>
                <span title={!assignee ? "Pick a staff member to enable Assign" : `Assign to ${assignee.slice(0, 8)}`}>
                  <button
                    disabled={!assignee}
                    onClick={() => assignee && patch.mutate({ assigned_to: assignee })}
                    className="inline-flex items-center justify-center rounded-md bg-[#14231a] px-4 py-2 text-sm font-medium text-white hover:bg-[#2a4a33] disabled:opacity-50"
                  >
                    Assign
                  </button>
                </span>
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                {data.assigned_to
                  ? `Assigned to ${data.assigned_to.slice(0, 8)}…`
                  : "Unassigned — pick a staff member above."}
              </p>
            </div>
          </Card>

          <Card>
            <SectionTitle>Internal notes</SectionTitle>
            <div className="flex gap-2">
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && note.trim()) addNote.mutate(note.trim());
                }}
                placeholder="Write a note for the team… (Enter to post)"
              />
              <span title={!note.trim() ? "Type a note to enable Post" : "Post note"}>
                <Button disabled={!note.trim()} onClick={() => addNote.mutate(note.trim())}>
                  Post
                </Button>
              </span>
            </div>
            <ul className="mt-3 space-y-3 text-sm">
              {(data.notes ?? []).length === 0 && (
                <li className="text-zinc-500">No notes yet.</li>
              )}
              {(data.notes ?? []).map((n) => (
                <li key={n.id} className="flex gap-2.5 border-t border-zinc-100 pt-2.5">
                  <span
                    aria-hidden
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#2a4a33] text-[10px] font-bold text-white"
                  >
                    {initialsOf(n.staff_id)}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium text-zinc-500">
                      {(n.staff_id ?? "system").slice(0, 18)} · staff
                    </p>
                    <p className="mt-0.5 leading-relaxed">{n.note}</p>
                    <p className="mt-0.5 text-xs tabular-nums text-zinc-400" title={new Date(n.created_at).toLocaleString()}>
                      {timeAgo(n.created_at)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-sm font-semibold tracking-wide text-zinc-500">History</h2>
              <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-zinc-500">
                <input
                  type="checkbox"
                  checked={hideNoops}
                  onChange={(e) => setHideNoops(e.target.checked)}
                  className="accent-[#2a4a33]"
                />
                Hide no-change updates
              </label>
            </div>
            {historyGroups.length === 0 ? (
              <p className="text-sm text-zinc-500">
                Only repeated no-change updates — uncheck the toggle to see them.
              </p>
            ) : (
              <ol className="relative space-y-3 border-l-2 border-zinc-200 pl-0 text-sm">
                {historyGroups.map((g) => {
                  const first = g.entries[0];
                  const expanded = !!expandedGroups[g.key];
                  return (
                    <li key={g.key} className="relative pl-5">
                      <span
                        aria-hidden
                        className={`absolute -left-[7px] top-1 h-3 w-3 rounded-full ring-2 ring-white ${DOT[first.new_status] ?? "bg-zinc-300"}`}
                      />
                      <p>
                        <span className="text-zinc-500">{first.old_status ?? "created"} →</span>{" "}
                        <strong className="capitalize">{first.new_status.replace("_", " ")}</strong>
                        {g.count > 1 && (
                          <button
                            onClick={() =>
                              setExpandedGroups((m) => ({ ...m, [g.key]: !m[g.key] }))
                            }
                            aria-expanded={expanded}
                            title={expanded ? "Collapse repeats" : "Show each repeat"}
                            className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 hover:bg-zinc-200"
                          >
                            ×{g.count} {expanded ? "hide" : "show"}
                          </button>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        <span
                          className="mr-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-zinc-200 align-middle text-[8px] font-bold text-zinc-600"
                          title={first.changed_by ? `Changed by ${first.changed_by}` : "Changed by system"}
                        >
                          {initialsOf(first.changed_by)}
                        </span>
                        <span title={first.changed_by ?? "system"}>
                          {(first.changed_by ?? "system").slice(0, 12)}
                        </span>{" "}
                        · <span title={new Date(first.changed_at).toLocaleString()}>{timeAgo(first.changed_at)}</span>
                      </p>
                      {expanded && g.count > 1 && (
                        <ul className="mt-1.5 space-y-1 text-xs tabular-nums text-zinc-400">
                          {g.entries.map((e) => (
                            <li key={e.id} title={new Date(e.changed_at).toLocaleString()}>
                              {new Date(e.changed_at).toLocaleString()}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>
        </div>
      </div>

      {/* Lightbox */}
      {zoom && photoSrc && (
        <div
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/80 p-6"
          onClick={() => setZoom(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Photo fullscreen — press Escape or click anywhere to close"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photoSrc} alt="incident photo full" className="max-h-full max-w-full rounded-lg" />
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm text-white shadow-lg"
        >
          {toast.msg}
          <button
            onClick={toast.undo}
            className="rounded px-2 py-0.5 font-medium text-amber-300 hover:bg-white/10"
          >
            Undo
          </button>
        </div>
      )}
    </div>
  );
}
