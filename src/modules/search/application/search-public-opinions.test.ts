import { describe, expect, it } from "vitest";
import { normalizeOpinionSearchFilters } from "./search-public-opinions";

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
