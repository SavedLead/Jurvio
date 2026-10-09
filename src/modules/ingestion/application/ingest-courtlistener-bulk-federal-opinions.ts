import type postgres from "postgres";
import { readFederalCourtCodes } from "../providers/courtlistener/bulk-courts";
import { openBulkCsvFromUrl } from "../providers/courtlistener/bulk-opinions";
import type { ArtifactStore } from "./artifact-store";
import {
  DEFAULT_BULK_BASE_URL,
  ingestCourtListenerBulkOpinions,
  type BulkOpinionResult,
} from "./ingest-courtlistener-bulk-appellate-opinions";

type Sql = ReturnType<typeof postgres>;

export { DEFAULT_BULK_BASE_URL };

export interface BulkFederalOpinionOptions {
  snapshotDate: string;
  baseUrl?: string;
  minYear?: number;
  /** Inclusive upper bound on cluster filing year; undefined = no upper bound. Used
   * to run the federal corpus in bounded year windows (see the generic loader). */
  maxYear?: number;
  limit?: number;
  /**
   * Include federal bankruptcy courts ({FB, FBP}) in the court-code set. Bankruptcy
   * is enormous and low-value, so it is opt-in and defaults OFF; the default set is
   * appellate + district + special ({F, FD, FS}).
   */
  includeBankruptcy?: boolean;
  onProgress?: (progress: { opinionsWritten: number; opinionsSkipped: number }) => void;
}

export interface BulkFederalOpinionResult extends BulkOpinionResult {
  courtCodes: number;
  includeBankruptcy: boolean;
}

function courtsBulkUrl(baseUrl: string, snapshotDate: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/courts-${snapshotDate}.csv.bz2`;
}

/**
 * Federal lane: ingest ALL federal courts (the 13 appellate circuits + every federal
 * district court + federal special courts like CIT / Court of Federal Claims), driven
 * by CourtListener's own `courts` bulk file rather than a hand-maintained list.
 *
 * It first streams the tiny `courts` file to build the federal court-code set (honoring
 * the bankruptcy opt-in), then runs the same generic dockets -> clusters -> citations
 * -> opinions passes, filtering dockets by that set. Every bulk file is streamed and
 * decompressed in flight (never landed on disk) and opinion artifacts are routed through
 * the injected (Spaces-aware) artifact store.
 */
export async function ingestCourtListenerBulkFederalOpinions(
  sql: Sql,
  artifactStore: ArtifactStore,
  options: BulkFederalOpinionOptions,
): Promise<BulkFederalOpinionResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.snapshotDate)) {
    throw new Error("Bulk snapshot date must be YYYY-MM-DD");
  }
  const baseUrl = options.baseUrl ?? DEFAULT_BULK_BASE_URL;
  const includeBankruptcy = options.includeBankruptcy ?? false;

  // Pass 0: stream the courts bulk file and build the federal court-code set.
  const courtCodes = await readFederalCourtCodes(
    openBulkCsvFromUrl(courtsBulkUrl(baseUrl, options.snapshotDate)),
    { includeBankruptcy },
  );
  if (courtCodes.size === 0) {
    throw new Error(
      `No federal court codes were selected from courts-${options.snapshotDate}.csv.bz2; ` +
        "the courts bulk file may be missing for this snapshot or its jurisdiction column changed",
    );
  }

  const result = await ingestCourtListenerBulkOpinions(sql, artifactStore, {
    snapshotDate: options.snapshotDate,
    baseUrl,
    minYear: options.minYear,
    maxYear: options.maxYear,
    limit: options.limit,
    onProgress: options.onProgress,
    courtCodes,
    lane: "federal",
  });

  return { ...result, courtCodes: courtCodes.size, includeBankruptcy };
}
