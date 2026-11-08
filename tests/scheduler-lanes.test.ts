import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SCHEDULED_JOBS, SCHEDULER_LANES, jobsForLane } from "../scripts/scheduler-jobs";
import { newestBulkSnapshot } from "../src/modules/citations/application/resolve-missing-citations-bulk";

describe("scheduler lanes", () => {
  it("runs citation work only in the citations lane", () => {
    const citationJobs = SCHEDULED_JOBS.filter(job => job.command.some(part => /case-citations|cited-cases/.test(part)));
    expect(citationJobs.map(job => job.name).sort()).toEqual(["case-citation-graph", "cited-case-bulk-resolution"]);
    expect(citationJobs.every(job => job.lane === "citations")).toBe(true);
    expect(jobsForLane("citations").map(job => job.name).sort()).toEqual(["case-citation-graph", "citation-edges", "citation-nightly", "cited-case-bulk-resolution", "public-case-search", "public-directory-stats", "sitemap-snapshot"]);
    expect(jobsForLane("core").some(job => job.name === "case-citation-graph")).toBe(false);
  });

  it("gives every child a hard time budget and caps active docket refreshes", () => {
    for (const job of SCHEDULED_JOBS) {
      expect(job.budgetMs, job.name).toBeGreaterThanOrEqual(5 * 60_000);
      expect(job.budgetMs, job.name).toBeLessThanOrEqual(90 * 60_000);
    }
    const active = SCHEDULED_JOBS.find((job) => job.name === "federal-active-cases");
    expect(active?.command).toContain("--max-items=300");
    expect(active?.budgetMs).toBe(20 * 60_000);
    const scheduler = readFileSync("scripts/run-production-scheduler.ts", "utf8");
    expect(scheduler).toContain("JURVIO_JOB_BUDGET_MS");
    expect(scheduler).toContain('child.kill("SIGTERM")');
  });

  it("keeps every other job where it was and job names unique", () => {
    expect(jobsForLane("core").length).toBeGreaterThan(5);
    expect(jobsForLane("coa").length).toBeGreaterThan(0);
    expect(new Set(SCHEDULED_JOBS.map(job => job.name)).size).toBe(SCHEDULED_JOBS.length);
  });

  it("verifies the SCOTUS cadences and keeps the orders monitor off those intervals", () => {
    const interval = (name: string) => SCHEDULED_JOBS.find((job) => job.name === name)?.intervalMs;
    expect(interval("scotus-emergency")).toBe(10 * 60_000);
    expect(interval("scotus-live-dockets")).toBe(3 * 60 * 60_000);
    expect(interval("scotus-enriched")).toBe(20 * 60_000);
    const orders = SCHEDULED_JOBS.find((job) => job.name === "scotus-orders");
    expect(orders?.lane).toBe("core");
    expect(orders?.intervalMs).toBe(60 * 60_000);
    expect(orders?.command).toEqual(["jobs/run-scotus-orders.mjs", "--max-pdfs=1"]);
    expect(orders?.command.join(" ")).not.toContain("backfill");
    expect(interval("scotus-orders")).not.toBe(interval("scotus-emergency"));
    expect(interval("scotus-orders")).not.toBe(interval("scotus-live-dockets"));
    expect(interval("scotus-orders")).not.toBe(interval("scotus-enriched"));
  });

  it("rejects unknown lanes and keeps SCOTUS jobs in core only", () => {
    expect(() => jobsForLane("bogus")).toThrow(/must be one of/);
    for (const lane of SCHEDULER_LANES.filter(lane => lane !== "core")) {
      expect(jobsForLane(lane).some(job => job.name.startsWith("scotus-"))).toBe(false);
    }
  });

  it("ships a worker container for every lane and releases it", () => {
    const compose = readFileSync("docker-compose.production.yml", "utf8");
    const release = readFileSync("scripts/release-production.sh", "utf8");
    for (const lane of SCHEDULER_LANES) {
      expect(compose).toContain(`JURVIO_SCHEDULER_LANE: ${lane}`);
      expect(compose).toContain(`scheduler/${lane}.alive`);
      for (const step of ["pull app", "up -d app"]) {
        const line = release.split("\n").find(text => text.includes(step) && text.includes("worker-core"));
        expect(line, `${step} line`).toContain(`worker-${lane}`);
      }
    }
  });
});

describe("newest bulk snapshot", () => {
  const listing = (entries: Array<[string, number]>) =>
    `<ListBucketResult>${entries.map(([key, size]) => `<Contents><Key>bulk-data/${key}</Key><Size>${size}</Size></Contents>`).join("")}</ListBucketResult>`;

  it("picks the newest non-empty file and ignores placeholders and other files", () => {
    expect(newestBulkSnapshot(listing([
      ["citations-2026-06-30.csv.bz2", 127_000_000],
      ["citations-2026-09-30.csv.bz2", 127_400_000],
      ["citations-2026-10-31.csv.bz2", 14],
      ["citation-map-2027-01-01.csv.bz2", 900_000_000],
    ]), "citations")).toBe("2026-09-30");
  });

  it("returns null when nothing usable is listed", () => {
    expect(newestBulkSnapshot(listing([["citations-2024-03-01.csv.bz2", 14]]), "citations")).toBeNull();
  });
});
