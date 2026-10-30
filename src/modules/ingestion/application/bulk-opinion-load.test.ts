import { describe, expect, it } from "vitest";
import {
  decodeBulkOpinionCheckpoint,
  isFederalOpinionCourt,
  opinionStageCsv,
  stageOpinion,
  type OpinionClusterMatch,
} from "./bulk-opinion-load";
import type { CourtListenerBulkOpinion } from "../providers/courtlistener/bulk-opinions";

const match: OpinionClusterMatch = {
  providerClusterId: "9",
  clusterId: "00000000-0000-0000-0000-000000000001",
  caseId: "00000000-0000-0000-0000-000000000002",
  courtId: "00000000-0000-0000-0000-000000000003",
  courtCode: "ca9",
  jurisdiction: "F",
  caseName: "A v. B",
  caseIsDraft: true,
  dateFiled: "2020-01-01",
  precedentialStatus: "Published",
  citationCount: 2,
};

const opinion = {
  id: "1", cluster_id: "9", type: "040dissent", author_str: "", joined_by_str: "", per_curiam: false,
  download_url: "", local_path: "", sha1: "", html_with_citations: "<p>Big &amp; html</p>",
  html_columbia: "", html_lawbox: "", html: "", xml_harvard: "", plain_text: "", date_modified: "",
} as CourtListenerBulkOpinion;

describe("bulk opinion load", () => {
  it("keeps federal courts only, never SCOTUS or bankruptcy", () => {
    expect(isFederalOpinionCourt("ca9", "F")).toBe(true);
    expect(isFederalOpinionCourt("nysd", "FD")).toBe(true);
    expect(isFederalOpinionCourt("scotus", "F")).toBe(false);
    expect(isFederalOpinionCourt("nysb", "FB")).toBe(false);
    expect(isFederalOpinionCourt("cal", "S")).toBe(false);
  });

  it("stages text like the per-row writer and keeps text out of provider_metadata", () => {
    const staged = stageOpinion(opinion, match, "2026-09-30")!;
    expect(staged.contentText).toBe("Big & html");
    expect(staged.opinionType).toBe("dissent");
    expect(staged.title).toBe("A v. B — dissent");
    expect(JSON.parse(staged.providerMetadata)).not.toHaveProperty("html_with_citations");
    expect(staged.sourceUri).toBe("https://www.courtlistener.com/help/api/bulk-data/#opinion-2026-09-30-1");
    expect(stageOpinion({ ...opinion, html_with_citations: " " }, match, "2026-09-30")).toBeNull();
  });

  it("strips NUL bytes and quotes csv safely", () => {
    const staged = stageOpinion({ ...opinion, html_with_citations: "", plain_text: "a\u0000b, \"c\"\nd" }, match, "2026-09-30")!;
    const csv = opinionStageCsv([staged]);
    expect(csv).not.toContain("\u0000");
    expect(csv).toContain('"ab, ""c""\nd"');
  });

  it("clears a previous run's stop flag and ignores other snapshots", () => {
    const stored = JSON.stringify({ version: 1, snapshotDate: "2026-09-30", rowsConsumed: 10, merged: 4, stopped: "budget" });
    expect(decodeBulkOpinionCheckpoint(stored, "2026-09-30")).toMatchObject({ rowsConsumed: 10, merged: 4, stopped: null });
    expect(decodeBulkOpinionCheckpoint(stored, "2026-10-31").rowsConsumed).toBe(0);
  });
});
