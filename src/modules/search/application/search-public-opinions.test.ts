import { describe, expect, it } from "vitest";
import type postgres from "postgres";
import {
  assertStatementTimeoutMs,
  excerptAnchor,
  interpretSettledSearch,
  isStatementTimeout,
  listOpinionSearchFacets,
  normalizeOpinionSearchFilters,
  QueryTimedOutError,
  readQueryTimeout,
  responseForSearchError,
  searchPublicOpinions,
  timeoutSearchResponse,
} from "./search-public-opinions";

type Sql = ReturnType<typeof postgres>;

function failingSql(error: Error): Sql {
  return { begin: async () => { throw error; } } as unknown as Sql;
}

describe("normalizeOpinionSearchFilters", () => {
  it("bounds and validates public filter input", () => {
    expect(normalizeOpinionSearchFilters({ q: "  civil rights  ", from: "2020-01-02", to: "nope", page: "999", sort: "newest" })).toEqual({
      query: "civil rights", dateFrom: "2020-01-02", dateTo: undefined, court: undefined,
      precedentialStatus: undefined, opinionType: undefined, sort: "newest", page: 50,
    });
  });
  it("uses safe defaults", () => {
    expect(normalizeOpinionSearchFilters({ sort: "random", page: "zero" }).sort).toBe("relevance");
    expect(normalizeOpinionSearchFilters({ page: "zero" }).page).toBe(1);
  });
});

describe("opinion search degradation", () => {
  const filters = normalizeOpinionSearchFilters({ q: "securities", page: "2" });

  it("anchors excerpts on the first real word", () => {
    expect(excerptAnchor("Callais")).toBe("Callais");
    expect(excerptAnchor('"securities fraud"')).toBe("securities");
    expect(excerptAnchor("a an or")).toBe("");
  });

  it("rejects a statement timeout that is not a small integer", () => {
    expect(() => assertStatementTimeoutMs(8_000)).not.toThrow();
    expect(() => assertStatementTimeoutMs(0)).toThrow(/statement timeout/);
    expect(() => assertStatementTimeoutMs(1.5)).toThrow(/statement timeout/);
    expect(() => assertStatementTimeoutMs(60_000)).toThrow(/statement timeout/);
  });

  it("recognizes a Postgres statement timeout", () => {
    expect(isStatementTimeout({ code: "57014" })).toBe(true);
    expect(isStatementTimeout(new Error("canceling statement due to statement timeout"))).toBe(true);
    expect(isStatementTimeout(new Error("connection refused"))).toBe(false);
  });

  it("turns a statement timeout into an empty, uncached search response", async () => {
    const timeout = Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
    const response = await searchPublicOpinions(failingSql(timeout), filters);
    expect(response).toMatchObject({ results: [], total: 0, page: 2, timedOut: true });
    expect(responseForSearchError(filters, new Error("connection refused"))).toBeNull();
    await expect(searchPublicOpinions(failingSql(new Error("connection refused")), filters)).rejects.toThrow("connection refused");
  });

  it("turns a facet timeout into empty filters instead of failing the page", async () => {
    const timeout = Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
    await expect(listOpinionSearchFacets(failingSql(timeout))).resolves.toMatchObject({ courts: [], timedOut: true });
  });

  it("keeps a successful side when the other query times out", () => {
    const facets = { courts: [], precedentialStatuses: [], opinionTypes: [] };
    const settled = interpretSettledSearch(
      filters,
      { status: "rejected", reason: new QueryTimedOutError("search", timeoutSearchResponse(filters)) },
      { status: "fulfilled", value: facets },
    );
    expect(settled.response.timedOut).toBe(true);
    expect(settled.facets).toBe(facets);
    expect(readQueryTimeout(new Error("wrapped", { cause: new QueryTimedOutError("facets") }))?.scope).toBe("facets");
  });

  it("does not hide an unexpected search failure", () => {
    expect(() => interpretSettledSearch(
      filters,
      { status: "rejected", reason: new Error("connection refused") },
      { status: "fulfilled", value: { courts: [], precedentialStatuses: [], opinionTypes: [] } },
    )).toThrow("connection refused");
  });
});
