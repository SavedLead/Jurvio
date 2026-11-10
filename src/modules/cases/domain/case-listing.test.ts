import { describe, expect, it } from "vitest";
import {
  activeFilterChips,
  buildCaseListingHref,
  exactMatchKind,
  hasActiveFilters,
  hasUserText,
  highlightSegments,
  matchOpinionAuthorJudge,
  parseCaseListingParams,
  pickLatestCaseEvent,
  truncateLabel,
} from "./case-listing";

const now = new Date("2026-10-02T00:00:00Z");

describe("case listing parameters", () => {
  it("defaults to newest-first browsing with no filters", () => {
    const filters = parseCaseListingParams({}, now);
    expect(filters).toMatchObject({ page: 1, query: null, sort: "recent", density: "comfortable" });
    expect(hasActiveFilters(filters)).toBe(false);
    expect(buildCaseListingHref(filters)).toBe("/cases");
  });

  it("defaults to best match when a search is present", () => {
    const filters = parseCaseListingParams({ q: "  Loper   Bright " }, now);
    expect(filters.query).toBe("Loper Bright");
    expect(filters.sort).toBe("best");
    expect(buildCaseListingHref(filters)).toBe("/cases?q=Loper+Bright");
  });

  it("ignores best match without a search and unknown sorts", () => {
    expect(parseCaseListingParams({ sort: "best" }, now).sort).toBe("recent");
    expect(parseCaseListingParams({ sort: "random", q: "x y" }, now).sort).toBe("best");
    expect(parseCaseListingParams({ sort: "az", q: "x y" }, now).sort).toBe("az");
  });

  it("parses flags, years and density and round-trips them", () => {
    const filters = parseCaseListingParams({
      court: "scotus", party: "Missouri", firm: "Example LLP", decided: "1", opinion: "1", verified: "0",
      from: "2024", to: "2020", view: "compact", page: "3", sort: "oldest",
    }, now);
    expect(filters).toMatchObject({ decided: true, opinion: true, verified: false, fromYear: 2020, toYear: 2024, density: "compact", page: 3 });
    expect(parseCaseListingParams(Object.fromEntries(new URLSearchParams(buildCaseListingHref(filters).split("?")[1])), now)).toEqual(filters);
  });

  it("rejects malformed years and pages", () => {
    const filters = parseCaseListingParams({ from: "20x4", to: "3000", page: "-4" }, now);
    expect(filters.fromYear).toBeNull();
    expect(filters.toYear).toBeNull();
    expect(filters.page).toBe(1);
  });

  it("treats party, firm and query text as uncached user input", () => {
    expect(hasUserText(parseCaseListingParams({ court: "scotus", decided: "1" }, now))).toBe(false);
    expect(hasUserText(parseCaseListingParams({ firm: "Example" }, now))).toBe(true);
  });
});

describe("active filter chips", () => {
  it("removes exactly one filter per chip and resets pagination", () => {
    const filters = parseCaseListingParams({ q: "standing", court: "scotus", opinion: "1", page: "4" }, now);
    const chips = activeFilterChips(filters, "Supreme Court of the United States");
    expect(chips.map((chip) => chip.label)).toEqual(["“standing”", "Supreme Court of the United States", "Readable opinion"]);
    expect(chips[0]?.href).toBe("/cases?court=scotus&opinion=1");
    expect(chips[1]?.href).toBe("/cases?q=standing&opinion=1");
  });

  it("labels year ranges", () => {
    expect(activeFilterChips(parseCaseListingParams({ from: "2020" }, now), null)[0]?.label).toBe("2020 or later");
    expect(activeFilterChips(parseCaseListingParams({ from: "2020", to: "2020" }, now), null)[0]?.label).toBe("2020");
  });
});

describe("latest case event", () => {
  it("picks the most recent dated event", () => {
    expect(pickLatestCaseEvent({ filedOn: "2020-10-20", decidedOn: null, latestEntryOn: "2025-09-02", latestEntryDescription: "MEMORANDUM OPINION" }))
      .toEqual({ date: "2025-09-02", label: "MEMORANDUM OPINION" });
  });

  it("prefers the decision on equal dates and falls back to filing", () => {
    expect(pickLatestCaseEvent({ filedOn: "2024-01-01", decidedOn: "2024-06-28", latestEntryOn: "2024-06-28", latestEntryDescription: "Judgment" })?.label)
      .toBe("Decision issued");
    expect(pickLatestCaseEvent({ filedOn: "2024-01-01", decidedOn: null, latestEntryOn: null, latestEntryDescription: null })?.label)
      .toBe("Case filed");
    expect(pickLatestCaseEvent({ filedOn: null, decidedOn: null, latestEntryOn: null, latestEntryDescription: null })).toBeNull();
  });

  it("does not treat a date after today as the latest event", () => {
    expect(pickLatestCaseEvent({
      filedOn: "2027-09-29",
      decidedOn: null,
      latestEntryOn: null,
      latestEntryDescription: null,
      today: "2026-11-10",
    })).toBeNull();
    expect(pickLatestCaseEvent({
      filedOn: "2027-09-29",
      decidedOn: "1986-03-21",
      latestEntryOn: null,
      latestEntryDescription: null,
      today: "2026-11-10",
    })?.date).toBe("1986-03-21");
  });

  it("truncates long docket descriptions at a word boundary", () => {
    const label = truncateLabel("ORDER granting in part and denying in part motion to dismiss for failure to state a claim", 40);
    expect(label.endsWith("…")).toBe(true);
    expect(label.length).toBeLessThanOrEqual(41);
  });
});

describe("search highlighting", () => {
  it("marks every case-insensitive occurrence", () => {
    expect(highlightSegments("Standing and standing", "STANDING")).toEqual([
      { text: "Standing", match: true },
      { text: " and ", match: false },
      { text: "standing", match: true },
    ]);
  });

  it("does not highlight empty or single-character queries", () => {
    expect(highlightSegments("Murthy", "m")).toEqual([{ text: "Murthy", match: false }]);
    expect(highlightSegments("Murthy", null)).toEqual([{ text: "Murthy", match: false }]);
  });
});

describe("exact identifier matches", () => {
  const loper = { docketNumber: "22-451", officialCitation: "603 U.S. 369 (2024)" };

  it("matches docket numbers with or without the No. prefix", () => {
    expect(exactMatchKind("No. 22-451", loper)).toBe("docket");
    expect(exactMatchKind("22-451", loper)).toBe("docket");
  });

  it("matches citations with or without the year", () => {
    expect(exactMatchKind("603 U.S. 369", loper)).toBe("citation");
    expect(exactMatchKind("603 u.s. 369 (2024)", loper)).toBe("citation");
  });

  it("does not treat partial text as an exact match", () => {
    expect(exactMatchKind("22-45", loper)).toBeNull();
    expect(exactMatchKind("Loper", loper)).toBeNull();
  });
});

describe("opinion author judge links", () => {
  const roberts = { publicId: "jj-roberts1", normalizedName: "john g roberts jr" };
  const kagan = { publicId: "jj-kagan001", normalizedName: "elena kagan" };

  it("links an author to the single assigned judge with the same surname", () => {
    expect(matchOpinionAuthorJudge("Roberts, C.J.", [roberts, kagan])?.publicId).toBe("jj-roberts1");
    expect(matchOpinionAuthorJudge("Justice Kagan", [roberts, kagan])?.publicId).toBe("jj-kagan001");
    expect(matchOpinionAuthorJudge("ELENA KAGAN", [kagan])?.publicId).toBe("jj-kagan001");
  });

  it("leaves the name unlinked when no candidate or several candidates match", () => {
    expect(matchOpinionAuthorJudge("Barrett, J.", [roberts, kagan])).toBeNull();
    expect(matchOpinionAuthorJudge("Smith", [
      { publicId: "jj-smith0001", normalizedName: "john smith" },
      { publicId: "jj-smith0002", normalizedName: "jane smith" },
    ])).toBeNull();
    expect(matchOpinionAuthorJudge(null, [roberts])).toBeNull();
  });
});
