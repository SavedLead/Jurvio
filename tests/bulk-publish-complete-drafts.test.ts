import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const script = readFileSync("scripts/bulk-publish-complete-drafts.sh", "utf8");
const workflow = readFileSync(".github/workflows/bulk-publish-complete-drafts-once.yml", "utf8");

describe("bulk publish of complete drafts", () => {
  it("publishes only complete non-thin drafts and leaves the alert clock alone", () => {
    expect(script).toContain("length(btrim(windowed.caption)) > 0");
    expect(script).toContain("length(btrim(windowed.docket_number)) > 0");
    expect(script).toContain("windowed.filed_on IS NOT NULL");
    expect(script).toContain("judge_case_assignment");
    expect(script).toContain("party_appearance");
    expect(script).toContain("docket_entry");
    expect(script).toContain("cause_of_action");
    expect(script).toContain("nature_of_suit_code");
    expect(script).toContain("<> 'scotus'");
    expect(script).toContain("updated_at = c.updated_at");
    expect(script).toContain("jurvio.defer_search_refresh");
    expect(script).toContain("restricted_or_sensitive");
    expect(script).toContain("RANGE=75000");
    expect(script).not.toMatch(/entity_alert|sleep /);
  });

  it("is a manual ingestion-host job with a count mode and a publish mode", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toContain("push:");
    expect(workflow).toContain("BULK_PUBLISH_COUNT");
    expect(workflow).toContain("BULK_PUBLISH_RUN");
    expect(workflow).toContain("10.116.0.2");
    expect(workflow).not.toContain("sudo");
  });
});
