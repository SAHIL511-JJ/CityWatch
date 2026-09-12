import { buildQuery } from "./api";

export const INCIDENT_PAGE_SIZE = 25;

export type IncidentStateFilter = "" | "needs_attention" | "resolved";
export type IncidentSlaFilter = "" | "overdue" | "breaching";
export type IncidentQueueFilter = "" | "mine" | "unassigned";
export type IncidentSort = "newest" | "oldest" | "severity" | "action";

export interface IncidentScope {
  q: string;
  status: string;
  severity: string;
  queue: IncidentQueueFilter;
  window_days: number | null;
  state: IncidentStateFilter;
  sla: IncidentSlaFilter;
  sort: IncidentSort;
  page: number;
}

const VALID_STATES: IncidentStateFilter[] = ["", "needs_attention", "resolved"];
const VALID_SLA: IncidentSlaFilter[] = ["", "overdue", "breaching"];

export function readIncidentScope(params: Readonly<URLSearchParams>): IncidentScope {
  const page = Number(params.get("page"));
  const windowDays = Number(params.get("window_days"));
  const state = params.get("state") as IncidentStateFilter;
  const sla = params.get("sla") as IncidentSlaFilter;
  const sort = params.get("sort");
  const queue = params.get("queue");

  return {
    q: params.get("q") ?? "",
    status: params.get("status") ?? "",
    severity: params.get("severity") ?? "",
    queue: queue === "mine" || queue === "unassigned" ? queue : "",
    window_days: Number.isInteger(windowDays) && windowDays >= 1 && windowDays <= 365 ? windowDays : null,
    state: VALID_STATES.includes(state) ? state : "",
    sla: VALID_SLA.includes(sla) ? sla : "",
    sort: sort === "oldest" || sort === "severity" || sort === "action" ? sort : "newest",
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

export function incidentScopeQuery(scope: IncidentScope, includePageSize = true): string {
  return buildQuery({
    q: scope.q || undefined,
    status: scope.status || undefined,
    severity: scope.severity || undefined,
    queue: scope.queue || undefined,
    window_days: scope.window_days ? String(scope.window_days) : undefined,
    state: scope.state || undefined,
    sla: scope.sla || undefined,
    sort: scope.sort === "newest" ? undefined : scope.sort,
    page: scope.page > 1 ? String(scope.page) : undefined,
    page_size: includePageSize ? String(INCIDENT_PAGE_SIZE) : undefined,
  });
}

export function incidentHref(params: Partial<IncidentScope>): string {
  return `/incidents${buildQuery({
    q: params.q || undefined,
    status: params.status || undefined,
    severity: params.severity || undefined,
    queue: params.queue || undefined,
    window_days: params.window_days ? String(params.window_days) : undefined,
    state: params.state || undefined,
    sla: params.sla || undefined,
    sort: params.sort && params.sort !== "newest" ? params.sort : undefined,
    page: params.page && params.page > 1 ? String(params.page) : undefined,
    page_size: undefined,
  })}`;
}
