import type { Severity } from "./types";

/** SLA response budgets in hours. Terminal states are exempt. */
export const SLA_HOURS: Record<Severity, number> = {
  critical: 1,
  high: 4,
  medium: 24,
  low: 48,
};

const TERMINAL = new Set(["resolved", "closed"]);

export type SlaState = "overdue" | "breaching" | "ok";

export interface SlaInfo {
  state: SlaState;
  ageHrs: number;
  budgetHrs: number;
  /** 0..1+ fraction of budget consumed */
  ratio: number;
}

/** Breaching once 75% of the budget is consumed. Returns null for terminal states. */
export function slaFor(createdAt: string, severity: Severity, status: string): SlaInfo | null {
  if (TERMINAL.has(status)) return null;
  const budget = SLA_HOURS[severity] ?? SLA_HOURS.medium;
  const ageHrs = Math.max(0, (Date.now() - new Date(createdAt).getTime()) / 3600000);
  const ratio = ageHrs / budget;
  return {
    state: ratio >= 1 ? "overdue" : ratio >= 0.75 ? "breaching" : "ok",
    ageHrs,
    budgetHrs: budget,
    ratio,
  };
}

export function slaLabel(info: SlaInfo): string {
  const age =
    info.ageHrs < 1
      ? `${Math.round(info.ageHrs * 60)}m`
      : info.ageHrs < 48
        ? `${Math.round(info.ageHrs * 10) / 10}h`
        : `${Math.round(info.ageHrs / 24)}d`;
  if (info.state === "overdue") return `Overdue ${age} (budget ${info.budgetHrs}h)`;
  if (info.state === "breaching")
    return `Breaching ${age} of ${info.budgetHrs}h budget`;
  return `${age} old · ${info.budgetHrs}h budget`;
}
