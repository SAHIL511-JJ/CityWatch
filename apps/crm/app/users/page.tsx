"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { AppUser } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function UsersPage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => apiFetch<AppUser[]>("/admin/users"),
  });

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      apiFetch(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  if (isLoading) return <p>Loading users…</p>;
  if (error) return <p className="text-red-600">{(error as Error).message}</p>;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Users</h1>
      <div className="grid gap-3">
        {(data ?? []).map((u) => (
          <Card key={u.id}>
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{u.email ?? u.phone ?? u.device_id ?? u.id}</p>
              {u.verified && <Badge value="verified" />}
              {u.banned && <Badge value="banned" />}
              <span className="ml-auto text-sm text-zinc-600">trust: {u.trust_score}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {!u.verified && (
                <Button onClick={() => patch.mutate({ id: u.id, body: { verified: true } })}>
                  Verify
                </Button>
              )}
              {u.banned ? (
                <Button onClick={() => patch.mutate({ id: u.id, body: { banned: false } })}>
                  Unban
                </Button>
              ) : (
                <Button onClick={() => patch.mutate({ id: u.id, body: { banned: true } })}>
                  Ban
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
