/**
 * A small, per-source fetch budget. Every live feed source gets its own
 * instance, so one slow or rate-limited court cannot spend another's budget.
 *
 * - waits at least `minIntervalMs` between requests (politeness),
 * - stops after `maxRequests` or `maxMs` (BudgetExhaustedError),
 * - stops for good on HTTP 429 and remembers Retry-After (RateLimitedError).
 */
export class BudgetExhaustedError extends Error {
  constructor(source: string, reason: string) {
    super(`${source}: budget exhausted (${reason})`);
    this.name = "BudgetExhaustedError";
  }
}

export class RateLimitedError extends Error {
  constructor(readonly source: string, readonly retryAfterUntil: Date | null) {
    super(`${source}: HTTP 429${retryAfterUntil ? `, retry after ${retryAfterUntil.toISOString()}` : ""}`);
    this.name = "RateLimitedError";
  }
}

export interface FetchBudgetOptions {
  source: string;
  maxRequests: number;
  maxMs: number;
  minIntervalMs: number;
  timeoutMs?: number;
  userAgent?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Retry-After is either delta-seconds or an HTTP date. */
export function parseRetryAfter(header: string | null | undefined, nowMs: number): Date | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return new Date(nowMs + Number(trimmed) * 1000);
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

export const DEFAULT_USER_AGENT = "Jurvio legal research ingestion contact@jurvio.com";

export class FetchBudget {
  readonly source: string;
  private readonly options: Required<Omit<FetchBudgetOptions, "fetchImpl" | "now" | "sleep" | "userAgent">>;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly userAgent: string;
  private readonly startedAt: number;
  private lastRequestAt = 0;
  requests = 0;
  rateLimited: RateLimitedError | null = null;

  constructor(options: FetchBudgetOptions) {
    this.source = options.source;
    this.options = {
      source: options.source,
      maxRequests: options.maxRequests,
      maxMs: options.maxMs,
      minIntervalMs: options.minIntervalMs,
      timeoutMs: options.timeoutMs ?? 30_000,
    };
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.userAgent = options.userAgent ?? process.env.INGESTION_USER_AGENT ?? DEFAULT_USER_AGENT;
    this.startedAt = this.now();
  }

  get remainingRequests(): number {
    return Math.max(0, this.options.maxRequests - this.requests);
  }

  /** True while another request may be made. */
  get canFetch(): boolean {
    return !this.rateLimited && this.remainingRequests > 0 && this.now() - this.startedAt < this.options.maxMs;
  }

  /**
   * GET a URL inside the budget. Returns the Response for any status other
   * than 429 (callers decide what 404 means); throws on 429 or exhaustion.
   */
  async get(url: string, accept = "*/*", init: { method?: "GET" | "POST"; body?: string } = {}): Promise<Response> {
    if (this.rateLimited) throw this.rateLimited;
    if (this.remainingRequests <= 0) throw new BudgetExhaustedError(this.source, "max requests");
    if (this.now() - this.startedAt >= this.options.maxMs) throw new BudgetExhaustedError(this.source, "max time");
    const wait = this.lastRequestAt + this.options.minIntervalMs - this.now();
    if (this.lastRequestAt > 0 && wait > 0) await this.sleep(wait);
    this.requests += 1;
    this.lastRequestAt = this.now();
    const response = await this.fetchImpl(url, {
      method: init.method ?? "GET",
      body: init.body,
      headers: {
        "User-Agent": this.userAgent, Accept: accept,
        ...(init.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      redirect: "follow",
      signal: AbortSignal.timeout(this.options.timeoutMs),
    });
    if (response.status === 429) {
      this.rateLimited = new RateLimitedError(this.source, parseRetryAfter(response.headers.get("retry-after"), this.now()));
      throw this.rateLimited;
    }
    return response;
  }

  /** GET (or POST a form) and return the body as text; non-2xx is an error. */
  async text(url: string, accept?: string, init?: { method?: "GET" | "POST"; body?: string }): Promise<string> {
    const response = await this.get(url, accept, init);
    if (!response.ok) throw new Error(`${this.source}: ${url} returned HTTP ${response.status}`);
    return response.text();
  }
}
