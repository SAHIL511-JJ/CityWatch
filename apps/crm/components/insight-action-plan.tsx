"use client";

import type { InsightActionPlan } from "@/lib/types";

const PRIORITY_META = {
  immediate: { label: "Immediate response", tone: "border-[#e3b9b0] bg-[#fff5f2] text-[#8f3024]", dot: "bg-[#b83b3b]" },
  priority: { label: "Prioritise", tone: "border-[#e6d5aa] bg-[#fffaf0] text-[#80611e]", dot: "bg-[#b5822b]" },
  routine: { label: "Planned response", tone: "border-[#cbdacb] bg-[#f1f6ef] text-[#2a4a33]", dot: "bg-[#278557]" },
} as const;

function StepList({ items, compact = false }: { items: string[]; compact?: boolean }) {
  const visible = compact ? items.slice(0, 2) : items;
  return (
    <ol className="space-y-2.5">
      {visible.map((item, index) => (
        <li key={item} className="flex gap-2.5 text-sm leading-5 text-zinc-700">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#dce8dc] text-[10px] font-bold text-[#2a4a33]">{index + 1}</span>
          <span>{item}</span>
        </li>
      ))}
    </ol>
  );
}

export function InsightActionPlan({ plan, compact = false }: { plan: InsightActionPlan; compact?: boolean }) {
  const priority = PRIORITY_META[plan.priority] ?? PRIORITY_META.routine;
  return (
    <section className={`rounded-2xl border p-5 ${compact ? "border-[#dfe5dd] bg-[#fbfcfa]" : "border-[#b8ccb9] bg-[#f1f6ef]"}`} aria-label="Recommended response">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#55705c]">Recommended response</p>
          <h3 className="mt-1 text-lg font-bold tracking-[-0.02em] text-[#14231a]">How to solve this signal</h3>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] ${priority.tone}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${priority.dot}`} />{priority.label}
        </span>
      </div>
      <p className="mt-3 text-sm font-medium leading-6 text-[#2a4a33]">{plan.objective}</p>
      <div className={`${compact ? "mt-4" : "mt-5 grid gap-5 lg:grid-cols-[1.2fr_.8fr]"}`}>
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Start here</p>
          <StepList items={plan.immediate_steps} compact={compact} />
        </div>
        {!compact && (
          <div className="space-y-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Route to</p>
              <p className="mt-1 text-sm font-semibold leading-5 text-[#14231a]">{plan.authority}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Escalate when</p>
              <ul className="mt-1 space-y-1.5 text-sm leading-5 text-zinc-700">{plan.escalate_when.map((item) => <li key={item}>• {item}</li>)}</ul>
            </div>
          </div>
        )}
      </div>
      {!compact && <div className="mt-5 border-t border-black/10 pt-4"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Verify the outcome</p><p className="mt-1 text-sm leading-5 text-zinc-700">{plan.verify}</p></div>}
      {compact && <p className="mt-4 border-t border-zinc-200 pt-3 text-xs font-semibold text-[#2a4a33]">Route to {plan.authority} · full response brief on the evidence page</p>}
      <p className="mt-4 text-[11px] leading-5 text-zinc-500">Read-only guidance based on the verified signal. Follow local safety procedures and operating standards.</p>
    </section>
  );
}
