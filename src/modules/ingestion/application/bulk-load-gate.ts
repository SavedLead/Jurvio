import { statfs } from "node:fs/promises";
import os from "node:os";
import type postgres from "postgres";
import {
  BULK_DOCKET_DISK_FLOOR,
  BULK_DOCKET_LOAD_PAUSE_MS,
  BULK_DOCKET_MAX_PAUSES,
  freeDiskRatio,
  shouldPauseForLoad,
} from "./bulk-docket-load";

type Sql = ReturnType<typeof postgres>;

export interface BulkGateResult {
  stop: string | null;
  pauses: number;
  freeDiskRatio: number | null;
}

/**
 * The per-chunk gate shared by the bulk cluster and opinion loaders (the docket
 * loader keeps its own copy): stop under the 30% disk floor, pause while the box is
 * loaded or a public query has run over 2s, and stop after too many pauses.
 */
export async function gateBulkChunk(
  sql: Sql,
  diskPath: string,
  label: string,
  sleep?: (ms: number) => Promise<void>,
): Promise<BulkGateResult> {
  let pauses = 0;
  for (;;) {
    const disk = await statfs(diskPath).catch(() => null);
    const ratio = disk ? freeDiskRatio(disk.blocks, disk.bavail) : null;
    if (ratio === null || ratio < BULK_DOCKET_DISK_FLOOR) return { stop: "disk", pauses, freeDiskRatio: ratio };
    const [load] = await sql<{ slow: number }[]>`
      SELECT count(*)::int AS slow
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND state = 'active'
        AND application_name IN ('jurvio-web', 'jurvio-search')
        AND now() - query_start > interval '2 seconds'
        AND pid <> pg_backend_pid()
    `;
    const pause = shouldPauseForLoad({ loadAverage: os.loadavg()[0] ?? 0, cpuCount: os.cpus().length, slowPublicQueries: load?.slow ?? 0 });
    if (!pause) return { stop: null, pauses, freeDiskRatio: ratio };
    pauses += 1;
    if (pauses > BULK_DOCKET_MAX_PAUSES) return { stop: "paused", pauses, freeDiskRatio: ratio };
    console.log(JSON.stringify({ [label]: "pause", pauses, slowPublicQueries: load?.slow ?? 0 }));
    await (sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(BULK_DOCKET_LOAD_PAUSE_MS);
  }
}

/** CourtListener court codes (with jurisdiction) that the bulk opinion path treats as federal. */
export async function federalOpinionCourtIds(
  sql: Sql,
  providerId: string,
  isFederal: (courtCode: string, jurisdiction: string | null) => boolean,
): Promise<string[]> {
  const courts = await sql<{ id: string; code: string; jurisdiction: string | null }[]>`
    SELECT id, provider_court_id AS code, jurisdiction FROM court
    WHERE provider_id = ${providerId} AND provider_court_id IS NOT NULL
  `;
  return courts.filter((court) => isFederal(court.code, court.jurisdiction)).map((court) => court.id);
}
