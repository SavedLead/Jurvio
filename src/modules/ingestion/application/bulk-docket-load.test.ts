import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  csvField,
  decodeBulkDocketCheckpoint,
  freeDiskRatio,
  isEasternQuietWindow,
  normalizeDocketKey,
  rowsPerHour,
  shouldPauseForLoad,
  stageCsv,
  stageDocket,
} from "./bulk-docket-load";
import type { CourtListenerBulkDocket } from "../providers/courtlistener/bulk-dockets";

const sample = {
  id: "42",
  court_id: "nysd",
  docket_number: "1:26-cv-00001",
  case_name: "Example v. Agency",
  case_name_short: "",
  date_filed: "2026-01-02",
  date_terminated: "",
  date_modified: "2026-07-28T00:00:00Z",
  cause: "",
  nature_of_suit: "440",
} as CourtListenerBulkDocket;

describe("bulk docket load guards", () => {
  it("treats 1:00 through 6:59 America/New_York as the quiet window", () => {
    expect(isEasternQuietWindow(new Date("2026-10-29T05:30:00Z"))).toBe(true);
    expect(isEasternQuietWindow(new Date("2026-10-29T10:30:00Z"))).toBe(true);
    expect(isEasternQuietWindow(new Date("2026-10-29T11:00:00Z"))).toBe(false);
    expect(isEasternQuietWindow(new Date("2026-10-29T04:30:00Z"))).toBe(false);
  });

  it("stops below 30 percent free disk and pauses on public or cpu pressure", () => {
    expect(freeDiskRatio(100, 29)).toBeLessThan(0.3);
    expect(freeDiskRatio(100, 40)).toBeGreaterThan(0.3);
    expect(freeDiskRatio(0, 10)).toBe(0);
    expect(shouldPauseForLoad({ loadAverage: 7, cpuCount: 8, slowPublicQueries: 0 })).toBe(true);
    expect(shouldPauseForLoad({ loadAverage: 1, cpuCount: 8, slowPublicQueries: 2 })).toBe(true);
    expect(shouldPauseForLoad({ loadAverage: 1, cpuCount: 8, slowPublicQueries: 0 })).toBe(false);
  });

  it("stages a draft row and quotes csv safely", () => {
    const staged = stageDocket(sample);
    expect(staged?.publication).toBe("draft");
    expect(staged?.normalizedDocket).toBe(normalizeDocketKey("1:26-cv-00001"));
    expect(stageDocket({ ...sample, docket_number: " " })).toBeNull();
    expect(stageDocket({ ...sample, case_name: "Sealed grand jury matter", case_name_short: "" })?.publication).toBe("restricted");
    expect(csvField(null)).toBe("\\N");
    expect(csvField('say "hi", now')).toBe('"say ""hi"", now"');
    expect(stageCsv(staged ? [staged] : [])).toContain("nysd");
    expect(rowsPerHour(100_000, 3_600_000)).toBe(100_000);
  });

  it("ignores a checkpoint from a different snapshot", () => {
    const decoded = decodeBulkDocketCheckpoint(JSON.stringify({
      version: 1,
      snapshotDate: "2026-06-30",
      rowsConsumed: 10,
      merged: 4,
    }), "2026-09-30");
    expect(decoded.rowsConsumed).toBe(0);
  });

  it("does not publish or index the merged rows", () => {
    const source = readFileSync("src/modules/ingestion/application/bulk-docket-load.ts", "utf8");
    const merge = source.slice(source.indexOf("export async function mergeDocketStage"));
    expect(merge).toContain("'not_verified', stage.publication::publication_state");
    expect(merge).not.toContain("opinion_search_projection");
    expect(merge).not.toContain("publication_decision");
    expect(merge).not.toContain("outbox_event");
    expect(merge).toContain("COPY courtlistener_docket_stage");
  });
});
