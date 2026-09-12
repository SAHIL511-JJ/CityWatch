"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { AppUser } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FeedbackPanel } from "@/components/ui/feedback-panel";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";

const FONT = { fontFamily: "Verdana, Geneva, sans-serif" } as const;

type FilterKey = "all" | "verified" | "banned" | "unverified";
type SortKey = "trust" | "newest";

function initialsOf(u: AppUser): string {
  const raw = u.email ?? u.phone ?? u.device_id ?? u.id;
  return raw.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase() || "U";
}

function trustColor(t: number): string {
  if (t >= 0.7) return "bg-green-600";
  if (t >= 0.4) return "bg-amber-500";
  return "bg-red-500";
}

function roleOf(u: AppUser): string {
  if (u.banned) return "banned";
  if (u.verified) return "verified";
  return "unverified";
}

export default function UsersPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sort, setSort] = useState<SortKey>("trust");
  const [banning, setBanning] = useState<AppUser | null>(null);
  const [banReason, setBanReason] = useState("");
  const [toast, setToast] = useState<{ msg: string; undo: () => void } | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => apiFetch<AppUser[]>("/admin/users"),
  });

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      apiFetch(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = (data ?? []).filter((u) => {
      if (filter === "verified" && !u.verified) return false;
      if (filter === "banned" && !u.banned) return false;
      if (filter === "unverified" && u.verified) return false;
      if (!q) return true;
      return [u.email, u.phone, u.device_id, u.id]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
    return [...filtered].sort((a, b) =>
      sort === "trust"
        ? b.trust_score - a.trust_score
        : new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [data, search, filter, sort]);

  const verify = (u: AppUser) => {
    patch.mutate(
      { id: u.id, body: { verified: true } },
      {
        onSuccess: () =>
          setToast({
            msg: `Verified ${u.email ?? u.device_id ?? "user"}`,
            undo: () => {
              patch.mutate({ id: u.id, body: { verified: false } });
              setToast(null);
            },
          }),
      }
    );
  };

  const confirmBan = () => {
    if (!banning) return;
    const u = banning;
    patch.mutate(
      { id: u.id, body: { banned: true } },
      {
        onSuccess: () => {
          setBanning(null);
          setBanReason("");
          setToast({
            msg: `Banned ${u.email ?? u.device_id ?? "user"}${banReason.trim() ? ` — ${banReason.trim()}` : ""}`,
            undo: () => {
              patch.mutate({ id: u.id, body: { banned: false } });
              setToast(null);
            },
          });
        },
      }
    );
  };

  const unban = (u: AppUser) => {
    patch.mutate(
      { id: u.id, body: { banned: false } },
      {
        onSuccess: () =>
          setToast({
            msg: `Unbanned ${u.email ?? u.device_id ?? "user"}`,
            undo: () => {
              patch.mutate({ id: u.id, body: { banned: true } });
              setToast(null);
            },
          }),
      }
    );
  };

  const selectCls =
    "rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#2a4a33]";

  return (
    <div className="mx-auto max-w-[1500px] space-y-6 pb-10" style={FONT}>
      <PageHeader
        eyebrow="Manage people"
        title="Users"
        description="Review citizen identity, trust, and access status before taking a moderation action."
        meta={<span aria-live="polite">{isLoading ? "Loading users…" : `${rows.length} visible user${rows.length === 1 ? "" : "s"}`}</span>}
      />
      {/* Toolbar */}
      <Card className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-52 flex-1">
            <label htmlFor="users-search" className="mb-1 block text-xs font-medium text-zinc-500">
              Search
            </label>
            <Input
              id="users-search"
              placeholder="Search email, phone, or device…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="focus:border-[#2a4a33]"
            />
          </div>
          <div>
            <label htmlFor="users-filter" className="mb-1 block text-xs font-medium text-zinc-500">
              Status
            </label>
            <select
              id="users-filter"
              className={`${selectCls} capitalize`}
              value={filter}
              onChange={(e) => setFilter(e.target.value as FilterKey)}
            >
              <option value="all">All users</option>
              <option value="verified">Verified</option>
              <option value="unverified">Unverified</option>
              <option value="banned">Banned</option>
            </select>
          </div>
          <div>
            <label htmlFor="users-sort" className="mb-1 block text-xs font-medium text-zinc-500">
              Sort
            </label>
            <select
              id="users-sort"
              className={selectCls}
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
            >
              <option value="trust">Highest trust</option>
              <option value="newest">Newest first</option>
            </select>
          </div>
        </div>
        <p className="text-sm text-zinc-500" aria-live="polite">
          {isLoading ? (
            "Loading users…"
          ) : (
            <>
              <strong className="text-zinc-800">{rows.length}</strong>{" "}
              {rows.length === 1 ? "user" : "users"}
            </>
          )}
        </p>
      </Card>

      {isLoading && (
        <div className="grid gap-3" aria-label="Loading users">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="flex animate-pulse items-center gap-4">
              <div className="h-10 w-10 shrink-0 rounded-full bg-zinc-200" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-1/4 rounded bg-zinc-200" />
                <div className="h-3 w-1/2 rounded bg-zinc-100" />
              </div>
              <div className="h-3 w-24 rounded bg-zinc-100" />
            </Card>
          ))}
        </div>
      )}

      {error && !isLoading && <FeedbackPanel variant="error" title="Users could not load" description={(error as Error).message} action={<Button onClick={() => refetch()}>Retry</Button>} />}

      {!isLoading && !error && rows.length === 0 && <FeedbackPanel title="No users match" description="Try widening the search or filter." action={(search || filter !== "all") ? <Button onClick={() => { setSearch(""); setFilter("all"); }}>Reset filters</Button> : undefined} />}

      <div className="grid gap-3">
        {rows.map((u) => {
          const contact = u.email ?? u.phone ?? u.device_id ?? u.id;
          const trust = Math.round(u.trust_score * 100) / 100;
          return (
            <Card key={u.id} className={`min-w-0 ${u.banned ? "border-red-200 bg-red-50/40" : ""}`}>
              <div className="flex flex-wrap items-center gap-3">
                <span
                  aria-hidden
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#2a4a33] text-xs font-bold text-white"
                >
                  {initialsOf(u)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium">{contact}</p>
                    {u.verified && <Badge value="verified" />}
                    {u.banned && <Badge value="banned" />}
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium capitalize text-zinc-600">
                      {roleOf(u)}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-zinc-500" title={u.id}>
                    {u.device_id && u.device_id !== contact ? `${u.device_id} · ` : ""}id {u.id.slice(0, 8)}…
                    {u.created_at ? ` · joined ${new Date(u.created_at).toLocaleDateString()}` : ""}
                  </p>
                  <div
                    className="mt-1.5 flex max-w-xs items-center gap-2"
                    role="img"
                    aria-label={`Trust score ${trust} out of 1`}
                    title={`Trust score ${trust}`}
                  >
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200">
                      <span
                        className={`block h-full rounded-full ${trustColor(u.trust_score)}`}
                        style={{ width: `${Math.min(100, Math.max(0, u.trust_score * 100))}%` }}
                      />
                    </span>
                    <span className="text-xs tabular-nums text-zinc-600">{trust.toFixed(2)}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!u.verified && !u.banned && (
                    <button
                      onClick={() => verify(u)}
                      disabled={patch.isPending}
                      className="inline-flex items-center justify-center rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-[#2a4a33] focus:ring-offset-2 disabled:cursor-wait disabled:opacity-50"
                    >
                      Verify
                    </button>
                  )}
                  {u.banned ? (
                    <button
                      onClick={() => unban(u)}
                      disabled={patch.isPending}
                      className="inline-flex items-center justify-center rounded-md bg-transparent px-4 py-2 text-sm font-medium text-zinc-600 ring-1 ring-inset ring-zinc-300 transition hover:bg-zinc-100 focus:outline-none focus:ring-2 focus:ring-[#2a4a33] focus:ring-offset-2 disabled:cursor-wait disabled:opacity-50"
                    >
                      Unban
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        setBanning(u);
                        setBanReason("");
                      }}
                      disabled={patch.isPending}
                      className="inline-flex items-center justify-center rounded-md bg-white px-4 py-2 text-sm font-medium text-red-700 ring-1 ring-inset ring-red-300 transition hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:cursor-wait disabled:opacity-50"
                    >
                      Ban
                    </button>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Ban confirm */}
      {banning && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
          onClick={() => setBanning(null)}
          role="dialog"
          aria-modal="true"
          aria-label={`Ban ${banning.email ?? banning.device_id ?? "user"}`}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
            style={FONT}
          >
            <h2 className="text-lg font-bold">Ban this user?</h2>
            <p className="mt-1 break-all text-sm text-zinc-500">
              {banning.email ?? banning.phone ?? banning.device_id ?? banning.id} will lose
              reporting access. This can be undone.
            </p>
            <label htmlFor="ban-reason" className="mb-1 mt-4 block text-xs font-medium text-zinc-500">
              Reason (shown in the undo toast)
            </label>
            <Input
              id="ban-reason"
              autoFocus
              placeholder="e.g. spam reports…"
              value={banReason}
              onChange={(e) => setBanReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmBan();
                if (e.key === "Escape") setBanning(null);
              }}
            />
            <div className="mt-4 flex gap-2">
              <button
                onClick={confirmBan}
                disabled={patch.isPending}
                className="inline-flex flex-1 items-center justify-center rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:cursor-wait disabled:opacity-50"
              >
                Confirm ban
              </button>
              <button
                onClick={() => setBanning(null)}
                className="inline-flex items-center justify-center rounded-md bg-white px-4 py-2 text-sm font-medium text-zinc-700 ring-1 ring-inset ring-zinc-300 transition hover:bg-zinc-100 focus:outline-none focus:ring-2 focus:ring-[#2a4a33] focus:ring-offset-2"
              >
                Cancel
              </button>
            </div>
          </div>
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
            className="rounded px-2 py-0.5 font-medium text-amber-300 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-amber-300 focus:ring-offset-2 focus:ring-offset-zinc-900"
          >
            Undo
          </button>
        </div>
      )}
    </div>
  );
}
