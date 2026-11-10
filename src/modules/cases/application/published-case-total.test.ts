import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeCaseCursor, encodeCaseCursor } from "@/modules/cases/domain/case-listing";
import { listingHasNarrowingFilter } from "./list-public-cases";

const listing = readFileSync("src/modules/cases/application/list-public-cases.ts", "utf8");
const coverage = readFileSync("src/modules/trust/application/get-coverage-snapshot.ts", "utf8");

describe("published case totals stay off the full table", () => {
  it("loads the unfiltered headline from stats or a planner estimate", () => {
    const cached = listing.slice(
      listing.indexOf("export async function readCachedPublishedTotal"),
      listing.indexOf("export function courtFacetKeySql"),
    );
    expect(cached).toContain("court_public_stats");
    expect(cached).toContain("reltuples");
    expect(cached).not.toMatch(/count\s*\(\s*\*\s*\)/i);
    expect(cached).not.toMatch(/from\s+legal_case/i);
  });

  it("counts legal_case only after a narrowing filter", () => {
    const list = listing.slice(listing.indexOf("export async function listPublicCases"));
    const guard = list.indexOf("listingHasNarrowingFilter");
    const liveCount = list.indexOf("SELECT count(*)::int AS total");
    expect(guard).toBeGreaterThan(-1);
    expect(liveCount).toBeGreaterThan(guard);
    expect(list.slice(0, liveCount)).toContain("narrowing");
    expect(list).toContain("readCachedPublishedTotal");
    expect(list).toContain("totalApproximate: !narrowing");
    expect(listingHasNarrowingFilter({})).toBe(false);
    expect(listingHasNarrowingFilter({ court: "caed" })).toBe(true);
  });

  it("does not recount every published case for the coverage headline", () => {
    expect(coverage).not.toMatch(/count\(\*\)::int FROM legal_case WHERE publication='published'/);
    expect(coverage).toContain("publishedCasesFromFamilies");
  });

  it("keeps the newest-first listing on a keyset and a limit", () => {
    const list = listing.slice(listing.indexOf("export async function listPublicCases"));
    expect(list).toContain("legal_case_published_recency_idx");
    expect(list).toContain("LIMIT ${pageSize}");
    expect(list).toContain("recentKeyset ? 0");
    const cursor = { on: "2026-11-09", caption: "Gomez v. Chestnut", id: "11111111-1111-4111-8111-111111111111" };
    expect(decodeCaseCursor(encodeCaseCursor(cursor))).toEqual(cursor);
    expect(decodeCaseCursor("not-a-cursor")).toBeNull();
  });
});
