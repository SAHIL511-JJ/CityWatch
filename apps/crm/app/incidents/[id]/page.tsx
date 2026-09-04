"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, getApiBase, getToken } from "@/lib/api";
import type { IncidentDetail, Severity } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { IncidentMiniMap } from "@/components/map";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 text-sm font-semibold tracking-wide text-zinc-500">{children}</h2>;
}

export default function IncidentDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [severity, setSeverity] = useState<Severity | "">("");
  const [assignee, setAssignee] = useState("");
  const [zoom, setZoom] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-incident", id],
    queryFn: () => apiFetch<IncidentDetail>(`/admin/incidents/${id}`),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-incident", id] });

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch(`/admin/incidents/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: refresh,
  });

  const addNote = useMutation({
    mutationFn: () =>
      apiFetch(`/admin/incidents/${id}/notes`, {
        method: "POST",
        body: JSON.stringify({ note }),
      }),
    onSuccess: () => {
      setNote("");
      refresh();
    },
  });

  const analyze = useMutation({
    mutationFn: () =>
      apiFetch<{ status: string }>(`/admin/incidents/${id}/analyze`, {
        method: "POST",
      }),
    onSuccess: refresh,
  });

  if (isLoading) return <p>Loading…</p>;
  if (error) return <p className="text-red-600">{(error as Error).message}</p>;
  if (!data) return <p>Not found</p>;

  const ai = (data.ai_analysis ?? {}) as Record<string, unknown>;
  const photoSrc = data.photo_url
    ? `${getApiBase()}/admin/incidents/${id}/photo?token=${getToken() ?? ""}`
    : null;
  const rep = data.reporter;
  const hasCoords = typeof data.lat === "number" && typeof data.lng === "number";

  return (
    <div className="space-y-5">
      {/* Header: status first, then title, then context */}
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge value={data.status} />
          <Badge value={data.severity} />
          {rep?.verified && <Badge value="verified reporter" />}
        </div>
        <h1 className="mt-2 text-2xl font-bold">{data.title}</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {data.address ?? (hasCoords ? `${data.lat}, ${data.lng}` : "No location")} ·{" "}
          {new Date(data.created_at).toLocaleString()}
          {rep && (
            <>
              {" "}· reported by {rep.email ?? rep.phone ?? rep.device_id ?? "anonymous"}
              {" "}(trust {rep.trust_score})
            </>
          )}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        {/* Left: evidence */}
        <div className="space-y-5 lg:col-span-3">
          <Card>
            <SectionTitle>Photo evidence</SectionTitle>
            {photoSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photoSrc}
                alt="incident photo"
                onClick={() => setZoom(true)}
                className="max-h-96 w-full cursor-zoom-in rounded-xl bg-zinc-100 object-contain"
              />
            ) : (
              <p className="text-sm text-zinc-500">No photo attached to this report.</p>
            )}
            <p className="mt-3 text-sm leading-relaxed">{data.description}</p>
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
            <SectionTitle>AI verdict</SectionTitle>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge value={String(ai.category ?? "—")} />
              <Badge value={String(ai.severity ?? data.severity)} />
              <span className="text-zinc-600">
                {typeof data.ai_confidence === "number"
                  ? `${Math.round(data.ai_confidence * 100)}% confident`
                  : "Not analyzed yet"}
              </span>
            </div>
            {typeof ai.reason === "string" && ai.reason && (
              <p className="mt-2 text-sm text-zinc-600">{ai.reason}</p>
            )}
            {!data.ai_analysis && (
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
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => analyze.mutate()} disabled={analyze.isPending}>
                {analyze.isPending ? "Analyzing…" : "Run AI analysis"}
              </Button>
            </div>
            <p className="mb-1 mt-4 text-xs font-medium text-zinc-500">Set status</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => patch.mutate({ status: "verified" })}>Approve</Button>
              <Button onClick={() => patch.mutate({ status: "rejected" })}>Reject</Button>
              <Button onClick={() => patch.mutate({ status: "escalated" })}>Escalate</Button>
              <Button onClick={() => patch.mutate({ status: "resolved" })}>Resolve</Button>
              <Button onClick={() => patch.mutate({ status: "closed" })}>Close</Button>
            </div>
            <div className="mt-3 flex gap-2">
              <select
                className="rounded-md border px-3 py-2 text-sm"
                value={severity}
                onChange={(e) => setSeverity(e.target.value as Severity | "")}
              >
                <option value="">severity…</option>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
                <option value="critical">critical</option>
              </select>
              <Button
                disabled={!severity}
                onClick={() => severity && patch.mutate({ severity })}
              >
                Save
              </Button>
            </div>
            <div className="mt-3 flex gap-2">
              <Input
                placeholder="staff id to assign"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
              />
              <Button
                disabled={!assignee}
                onClick={() => assignee && patch.mutate({ assigned_to: assignee })}
              >
                Assign
              </Button>
            </div>
            {data.assigned_to && (
              <p className="mt-2 text-xs text-zinc-500">Assigned to {data.assigned_to}</p>
            )}
          </Card>

          <Card>
            <SectionTitle>Internal notes</SectionTitle>
            <div className="flex gap-2">
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Write a note for the team…"
              />
              <Button disabled={!note} onClick={() => addNote.mutate()}>
                Post
              </Button>
            </div>
            <ul className="mt-3 space-y-2 text-sm">
              {(data.notes ?? []).length === 0 && (
                <li className="text-zinc-500">No notes yet.</li>
              )}
              {(data.notes ?? []).map((n) => (
                <li key={n.id} className="border-t pt-2">
                  {n.note}
                  <span className="ml-2 text-xs text-zinc-500">
                    {new Date(n.created_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <SectionTitle>History</SectionTitle>
            <ul className="space-y-2 text-sm">
              {(data.history ?? []).map((h) => (
                <li key={h.id} className="border-l-2 border-zinc-200 pl-3">
                  {h.old_status ?? "created"} → <strong>{h.new_status}</strong>
                  <span className="ml-2 text-xs text-zinc-500">
                    {new Date(h.changed_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      {/* Lightbox */}
      {zoom && photoSrc && (
        <div
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/80 p-6"
          onClick={() => setZoom(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photoSrc} alt="incident photo full" className="max-h-full max-w-full rounded-lg" />
        </div>
      )}
    </div>
  );
}
