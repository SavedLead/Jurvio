// Time budget for the federal active-case-updates lane (scheduler job
// "federal-active-cases"). The scheduler SIGTERMs the job when budgetMs runs
// out, so the job has to finish on its own first: stop taking new dockets with
// time left for the ones in flight, and abort any CourtListener request still
// running shortly before the budget.

export const ACTIVE_CASE_CHECKPOINT_STREAM = "federal-active-case-updates";

/** Used when JURVIO_JOB_BUDGET_MS is missing (manual runs). Matches the scheduler entry. */
export const DEFAULT_ACTIVE_CASE_BUDGET_MS = 20 * 60_000;

/** Requests are cut off this long before the budget so cleanup can commit. */
export const ACTIVE_CASE_EXIT_MARGIN_MS = 45_000;

export type ActiveCaseStopReason = "budget" | "rate_limited";

export type ActiveCaseBudget = {
  budgetMs: number;
  /** Epoch ms after which no new docket is started. */
  stopPullingAtMs: number;
  /** Epoch ms after which no CourtListener request may start, wait, or keep running. */
  requestDeadlineMs: number;
};

export function activeCaseBudget(input: { startedAtMs: number; budgetMs: number | null }): ActiveCaseBudget {
  const budgetMs = input.budgetMs && input.budgetMs > 0 ? input.budgetMs : DEFAULT_ACTIVE_CASE_BUDGET_MS;
  // Reserve for dockets already in flight: 20% of the budget, between 1 and 4 minutes.
  const reserveMs = Math.min(4 * 60_000, Math.max(60_000, budgetMs * 0.2));
  const requestDeadlineMs = input.startedAtMs + Math.max(budgetMs / 2, budgetMs - ACTIVE_CASE_EXIT_MARGIN_MS);
  const stopPullingAtMs = Math.min(input.startedAtMs + Math.max(budgetMs / 3, budgetMs - reserveMs), requestDeadlineMs);
  return { budgetMs, stopPullingAtMs, requestDeadlineMs };
}

/**
 * Errors that mean "stop this run", not "this docket is bad". Matched by name so
 * the domain layer does not import the HTTP client.
 */
export function activeCaseStopReason(error: unknown): ActiveCaseStopReason | null {
  const name = (error as { name?: unknown } | null)?.name;
  if (name === "CourtListenerRateLimited") return "rate_limited";
  if (name === "CourtListenerDeadlineReached") return "budget";
  return null;
}
