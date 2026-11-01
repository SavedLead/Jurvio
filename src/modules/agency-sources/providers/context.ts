import type { AgencyItem, AgencySourceDefinition } from "../domain/item";

export interface SourceContext {
  /** GET inside this source's polite budget (robots.txt checked first). Non-2xx throws HttpStatusError. */
  fetchText(url: string, accept?: string): Promise<string>;
  /** Which of these record ids this source already stored, with their stored change keys. */
  known(recordIds: readonly string[]): Promise<Map<string, string | null>>;
  canFetch(): boolean;
  now: Date;
  /** First pass for this source (no stored items yet): may read a little further back. */
  firstRun: boolean;
  /** The source's stored cursor from its last successful run (adapter-defined). */
  cursor: string | null;
}

export interface SourceOutcome {
  itemsSeen: number;
  items: AgencyItem[];
  /** Non-fatal per-item problems; the run is "partial" when present. */
  warnings: string[];
  cursor?: string | null;
}

export interface SourceAdapter {
  definition: AgencySourceDefinition;
  budget: { maxRequests: number; maxMs: number; minIntervalMs: number };
  run?(context: SourceContext): Promise<SourceOutcome>;
}

export class HttpStatusError extends Error {
  constructor(readonly url: string, readonly status: number) {
    super(`${url} returned HTTP ${status}`);
    this.name = "HttpStatusError";
  }
}

export class RobotsDisallowedError extends Error {
  constructor(readonly url: string) {
    super(`robots.txt disallows ${url}`);
    this.name = "RobotsDisallowedError";
  }
}
