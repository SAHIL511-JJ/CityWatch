"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { IncidentDetail, Severity } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function IncidentDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [severity, setSeverity] = useState<Severity | "">("");
  const [assignee, setAssignee] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-incident", id],
    queryFn: () => apiFetch<IncidentDetail>(`/admin/incidents/${id}`),
  });

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch(`/admin/incidents/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-incident", id] }),
  });

  const addNote = useMutation({
    mutationFn: () =>
      apiFetch(`/admin/incidents/${id}/notes`, {
        method: "POST",
        body: JSON.stringify({ note }),
      }),
    onSuccess: () => {
      setNote("");
      qc.invalidateQueries({ queryKey: ["admin-incident", id] });
    },
  });

  const analyze = useMutation({
    mutationFn: () =>
      apiFetch<{ status: string }>(`/admin/incidents/${id}/analyze`, {
        method: "POST",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-incident", id] }),
  });

  if (isLoading) return <p>Loading…</p>;
  if (error) return <p className="text-red-600">{(error as Error).message}</p>;
  if (!data) return <p>Not found</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-semibold">{data.title}</h1>
        <Badge value={data.status} />
        <Badge value={data.severity} />
      </div>
      <Card>
        <p className="text-sm">{data.description}</p>
        <p className="mt-2 text-xs text-zinc-500">
          {data.address ?? `${data.lat}, ${data.lng}`} ·{" "}
          {new Date(data.created_at).toLocaleString()}
        </p>
        {data.photo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.photo_url} alt="incident" className="mt-3 max-h-64 rounded" />
        )}
      </Card>

      <Card>
        <h2 className="mb-2 font-medium">Moderate</h2>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => analyze.mutate()} disabled={analyze.isPending}>
            {analyze.isPending ? "Analyzing…" : "Run AI analysis"}
          </Button>
          <Button onClick={() => patch.mutate({ status: "verified" })}>Approve</Button>
          <Button onClick={() => patch.mutate({ status: "rejected" })}>Reject</Button>
          <Button onClick={() => patch.mutate({ status: "escalated" })}>Escalate</Button>
          <Button onClick={() => patch.mutate({ status: "resolved" })}>Resolve</Button>
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
            Save severity
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
      </Card>

      <Card>
        <h2 className="mb-2 font-medium">Add note</h2>
        <div className="flex gap-2">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Internal note…" />
          <Button disabled={!note} onClick={() => addNote.mutate()}>
            Post
          </Button>
        </div>
        <ul className="mt-3 space-y-2 text-sm">
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
        <h2 className="mb-2 font-medium">History timeline</h2>
        <ul className="space-y-2 text-sm">
          {(data.history ?? []).map((h) => (
            <li key={h.id} className="border-l-2 border-zinc-200 pl-3">
              {h.old_status ?? "—"} → <strong>{h.new_status}</strong>
              <span className="ml-2 text-xs text-zinc-500">
                {new Date(h.changed_at).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
