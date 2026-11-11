import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const script = readFileSync("scripts/clear-bulk-opinion-holds.sh", "utf8");
const workflow = readFileSync(".github/workflows/clear-bulk-opinion-holds-once.yml", "utf8");
const opinionLoad = readFileSync("src/modules/ingestion/application/bulk-opinion-load.ts", "utf8");
const clusterLoad = readFileSync("src/modules/ingestion/application/bulk-cluster-load.ts", "utf8");

describe("bulk opinion case holds", () => {
  it("removes only that reason from v3 holds and deletes an empty row", () => {
    expect(script).toContain("bulk_opinion_text_pending_review");
    expect(script).toContain("federal-publication-v3");
    expect(script).toContain("array_remove(hold.reasons, '${REASON}')");
    expect(script).toContain("cardinality(hold.reasons) = 0");
    expect(script).toContain("DELETE FROM federal_publication_hold");
    expect(script).not.toContain("legal_case");
    expect(script).not.toContain("updated_at");
    expect(workflow).toContain("CLEAR_BULK_OPINION_HOLDS");
    expect(workflow).toContain("10.116.0.2");
    expect(workflow).not.toContain("push:");
    expect(workflow).not.toContain("workflow_run:");
  });

  it("does not stamp the blocking reason onto a draft case", () => {
    expect(opinionLoad).not.toContain("INSERT INTO federal_publication_hold");
    expect(clusterLoad).not.toContain("INSERT INTO federal_publication_hold");
    expect(opinionLoad).toContain("INSERT INTO citation_publication_hold");
  });
});
