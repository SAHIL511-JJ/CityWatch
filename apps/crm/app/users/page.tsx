"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { AppUser } from "@/lib/types";
import { Card } from "@/components/ui/card";

export default function UsersPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => apiFetch<AppUser[]>("/admin/users"),
  });

  if (isLoading) return <p>Loading users…</p>;
  if (error) return <p className="text-red-600">{(error as Error).message}</p>;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Users</h1>
      <div className="grid gap-3">
        {(data ?? []).map((u) => (
          <Card key={u.id}>
            <p className="font-medium">{u.email ?? u.phone ?? u.device_id ?? u.id}</p>
            <p className="text-sm text-zinc-600">
              verified: {String(u.verified)} · trust: {u.trust_score}
            </p>
          </Card>
        ))}
      </div>
    </div>
  );
}
