import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("federal re-scan stop", () => {
  const source = readFileSync("scripts/run-federal-ingestion-loop.ts", "utf8");

  it("refreshes a few hundred open dockets by last_fetched_at", () => {
    const active = source.slice(source.indexOf("async function runActiveUpdates"), source.indexOf("async function runMaterialDecisions"));
    expect(active).toContain("legal_case.last_fetched_at NULLS FIRST");
    expect(active).toContain("legal_case.terminated_on IS NULL");
    expect(active).toContain("legal_case.activity_state = 'active'");
    expect(active).toContain("activeCaseLimit");
    expect(active).not.toContain("source_updated_at ASC");
  });

  it("skips opinion clusters already stored and records a per-court watermark", () => {
    expect(source).toContain("federal_cluster_watermark");
    expect(source).toContain("unseenClusterIds");
    expect(source).toContain("provider_cluster_id = ANY");
  });

  it("does not string_agg the whole docket inside the candidate scan", () => {
    const select = source.slice(
      source.indexOf("async function selectPublicationCandidates"),
      source.indexOf("async function runPublicationAndQuarantine"),
    );
    expect(select.toLowerCase()).not.toContain("string_agg");
    const batched = source.slice(source.indexOf("async function attachRestrictedText"), source.indexOf("async function selectPublicationCandidates"));
    expect(batched).toContain("string_agg");
    expect(batched).toContain("ANY(${ids}::uuid[])");
  });

  it("stops pulling work when the job budget is reached", () => {
    expect(source).toContain("withinBudget()");
    expect(source).toContain("JURVIO_JOB_BUDGET_MS");
  });
});

describe("federal-active-cases budget awareness", () => {
  const source = readFileSync("scripts/run-federal-ingestion-loop.ts", "utf8");
  const active = source.slice(source.indexOf("async function runActiveUpdates"), source.indexOf("async function writeActiveCaseCheckpoint"));

  it("sets a request deadline and stops on 429 instead of sleeping", () => {
    expect(active).toContain("setCourtListenerRequestPolicy({ deadlineMs: budget.requestDeadlineMs, stopOnRateLimit: true })");
    expect(active).toContain("budget.stopPullingAtMs");
  });

  it("checkpoints after every docket and stamps failed dockets so they rotate", () => {
    expect(active.match(/await checkpoint\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(active).toContain("stampAttempted(row.case_id)");
    expect(source).toContain("ACTIVE_CASE_CHECKPOINT_STREAM");
  });

  it("bounds the selection query by the budget", () => {
    expect(active).toContain("SET LOCAL statement_timeout");
    expect(active).toContain("selection_timeout");
  });
});
