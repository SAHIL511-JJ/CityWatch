"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { StaffMember } from "@/lib/types";
import { staffName } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { FeedbackPanel } from "@/components/ui/feedback-panel";
import { PageHeader } from "@/components/ui/page-header";

const FONT = { fontFamily: "Verdana, Geneva, sans-serif" } as const;

const ROLE_COLOR: Record<string, string> = {
  admin: "bg-purple-100 text-purple-800",
  dispatcher: "bg-blue-100 text-blue-800",
  analyst: "bg-green-100 text-green-800",
};

export default function StaffPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-staff"],
    queryFn: () => apiFetch<StaffMember[]>("/admin/staff"),
  });

  return (
    <div className="mx-auto max-w-[1500px] space-y-6 pb-10" style={FONT}>
      <PageHeader
        eyebrow="Manage operations"
        title="Staff"
        description="See team coverage and open assignments before moving work between queues."
        meta={<span aria-live="polite">{isLoading ? "Loading staff…" : `${data?.length ?? 0} staff member${(data?.length ?? 0) === 1 ? "" : "s"}`}</span>}
      />
      <p className="text-sm text-zinc-500" aria-live="polite">
        {isLoading ? (
          "Loading staff…"
        ) : (
          <>
            <strong className="text-zinc-800">{data?.length ?? 0}</strong> staff members · only
            staff can own incidents
          </>
        )}
      </p>
      {isLoading && (
        <div className="grid gap-3" aria-label="Loading staff">
          {[0, 1].map((i) => (
            <Card key={i} className="flex animate-pulse items-center gap-4">
              <div className="h-10 w-10 shrink-0 rounded-full bg-zinc-200" />
              <div className="h-4 w-1/4 rounded bg-zinc-200" />
            </Card>
          ))}
        </div>
      )}
      {error && !isLoading && <FeedbackPanel variant="error" title="Staff could not load" description={(error as Error).message} />}
      {!isLoading && !error && (data ?? []).length === 0 && <FeedbackPanel title="No staff members found" description="Invite or configure an operations staff member before assigning incidents." />}
      <div className="grid gap-3">
        {(data ?? []).map((s) => {
          const name = staffName(s.email, s.id);
          const active = s.open_count > 0;
          return (
            <Card key={s.id}>
              <div className="flex flex-wrap items-center gap-3">
                <span
                  aria-hidden
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#2a4a33] text-xs font-bold text-white"
                >
                  {name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{name}</p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${ROLE_COLOR[s.role] ?? "bg-zinc-100 text-zinc-700"}`}
                    >
                      {s.role}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 text-xs ${active ? "text-green-700" : "text-zinc-500"}`}
                      title={active ? "Has open assigned incidents" : "No open assigned incidents"}
                    >
                      <span aria-hidden className={`inline-block h-1.5 w-1.5 rounded-full ${active ? "bg-green-500" : "bg-zinc-300"}`} />
                      {active ? "active" : "idle"}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-zinc-500" title={s.email}>
                    {s.email} · {s.open_count} open incident{s.open_count === 1 ? "" : "s"}
                  </p>
                </div>
                <Link
                  href={`/incidents`}
                  className="rounded-sm text-xs font-semibold text-[#2a4a33] hover:underline focus:outline-none focus:ring-2 focus:ring-[#2a4a33] focus:ring-offset-2"
                >
                  View queue
                </Link>
              </div>
            </Card>
          );
        })}
      </div>
      {!isLoading && !error && (data ?? []).length > 0 && (
        <Card className="bg-amber-50 text-sm text-amber-900">
          Citizen device IDs can never own incidents — assignment APIs reject non-staff IDs.
        </Card>
      )}
    </div>
  );
}
