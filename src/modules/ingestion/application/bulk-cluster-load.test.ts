import { describe, expect, it } from "vitest";
import {
  clusterStageCsv,
  decodeBulkClusterCheckpoint,
  isRestrictedCluster,
  slimClusterMetadata,
  stageCluster,
} from "./bulk-cluster-load";
import { courtListenerBulkOpinionClusterSchema } from "../providers/courtlistener/bulk-opinions";

const row = (overrides: Record<string, string> = {}) => courtListenerBulkOpinionClusterSchema.parse({
  id: "5561318", docket_id: "77", case_name: "Zone v. Zone", case_name_short: "Zone", case_name_full: "",
  date_filed: "1893-08-15", precedential_status: "Published", citation_count: "3", judges: "Habdin",
  syllabus: "", headmatter: "h".repeat(600), blocked: "f", date_modified: "2024-11-12 10:35:08.135113+00",
  ...overrides,
});

describe("bulk cluster load", () => {
  it("stages the cluster -> docket link with normalized fields", () => {
    const staged = stageCluster(row())!;
    expect(staged).toMatchObject({
      clusterId: "5561318", docketId: "77", caseName: "Zone v. Zone", dateFiled: "1893-08-15",
      precedentialStatus: "Published", citationCount: 3, judges: "Habdin", syllabus: null, restricted: false,
      dateModified: "2024-11-12T10:35:08.135Z",
    });
    expect(staged.publicId).toMatch(/^jo-[a-z0-9]{10}$/);
    const metadata = JSON.parse(staged.providerMetadata);
    expect(metadata.headmatter).toBeUndefined();
    expect(metadata._omitted).toEqual(["headmatter"]);
    expect(metadata.docket_id).toBe("77");
    expect(stageCluster(row({ case_name: "", case_name_short: "", case_name_full: "" }))).toBeNull();
    expect(stageCluster(row({ citation_count: "", date_filed: "unknown" }))).toMatchObject({ citationCount: 0, dateFiled: null });
  });

  it("treats blocked and sealed / minor / grand-jury captions as restricted", () => {
    expect(isRestrictedCluster(row())).toBe(false);
    expect(isRestrictedCluster(row({ blocked: "t" }))).toBe(true);
    expect(isRestrictedCluster(row({ case_name: "United States v. Sealed Defendant" }))).toBe(true);
    expect(isRestrictedCluster(row({ case_name_full: "In re Grand Jury Subpoena" }))).toBe(true);
  });

  it("writes COPY-safe csv", () => {
    const staged = stageCluster(row({ case_name: "A, \"B\"\u0000 v. C\nD" }))!;
    const csv = clusterStageCsv([staged]);
    expect(csv).not.toContain("\u0000");
    expect(csv.startsWith('5561318,77,"A, ""B"" v. C\nD",1893-08-15,Published,3,Habdin,\\N,\\N,f,')).toBe(true);
    expect(clusterStageCsv([])).toBe("");
  });

  it("keeps short metadata fields only", () => {
    expect(slimClusterMetadata({ a: "x", b: "y".repeat(513), c: null })).toEqual({ a: "x", c: null, _omitted: ["b"] });
  });

  it("decodes only its own snapshot's checkpoint", () => {
    const stored = JSON.stringify({ version: 1, snapshotDate: "2026-09-30", rowsConsumed: 7, created: 3, stopped: "complete" });
    expect(decodeBulkClusterCheckpoint(stored, "2026-09-30")).toMatchObject({ rowsConsumed: 7, created: 3, stopped: "complete" });
    expect(decodeBulkClusterCheckpoint(stored, "2026-10-31").rowsConsumed).toBe(0);
  });
});
