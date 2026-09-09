import { cn } from "@/lib/utils";

const colors: Record<string, string> = {
  processing: "bg-yellow-100 text-yellow-800",
  needs_review: "bg-orange-100 text-orange-800",
  verified: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
  escalated: "bg-purple-100 text-purple-800",
  resolved: "bg-blue-100 text-blue-800",
  awaiting_verification: "bg-amber-100 text-amber-800",
  community_confirmed: "bg-emerald-100 text-emerald-800",
  needs_follow_up: "bg-rose-100 text-rose-800",
  closed: "bg-zinc-200 text-zinc-700",
  low: "bg-zinc-100 text-zinc-700",
  medium: "bg-yellow-100 text-yellow-800",
  high: "bg-orange-100 text-orange-800",
  critical: "bg-red-100 text-red-800",
  banned: "bg-red-100 text-red-800",
};

const labels: Record<string, string> = {
  processing: "Processing",
  needs_review: "Needs review",
  verified: "Verified",
  rejected: "Rejected",
  escalated: "Escalated",
  resolved: "Resolved",
  awaiting_verification: "Awaiting verification",
  community_confirmed: "Community confirmed",
  needs_follow_up: "Needs follow-up",
  closed: "Closed",
};

export function Badge({ value }: { value: string }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
        colors[value] ?? "bg-zinc-100 text-zinc-700"
      )}
    >
      {labels[value] ?? value}
    </span>
  );
}
