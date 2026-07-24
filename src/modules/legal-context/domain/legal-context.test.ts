import { describe, expect, it } from "vitest";
import {
  extractCitationLabels,
  hasSourceBackedCaseContext,
  inlineLegalTerms,
} from "./legal-context";

describe("legal context", () => {
  it("uses the reviewed explainer definitions for the initial inline terms", () => {
    expect(inlineLegalTerms.map((term) => term.slug)).toEqual(expect.arrayContaining([
      "jurisdiction",
      "summary-judgment",
      "dismissal-with-or-without-prejudice",
      "remand",
      "injunction-and-tro",
      "standing",
      "venue",
      "appeal",
      "removal-to-federal-court",
      "service-of-process",
      "discovery",
      "appellate-mandate",
      "stay",
      "certiorari",
      "emergency-docket",
    ]));
    expect(inlineLegalTerms.every((term) => term.definition.length > 0)).toBe(true);
  });

  it("requires both relevance and a supporting source before showing case context", () => {
    expect(hasSourceBackedCaseContext({ citation: "1 U.S. 1", href: "/search" })).toBe(false);
    expect(hasSourceBackedCaseContext({
      citation: "1 U.S. 1",
      href: "/search",
      relevance: "Cited for the governing standard.",
      sourceHref: "https://example.test/source",
    })).toBe(true);
  });

  it("extracts only explicit citation-shaped fields and strings", () => {
    expect(extractCitationLabels([
      "410 U.S. 113",
      { citation: "347 U.S. 483", count: 2 },
      { unrelated: "must not appear" },
    ])).toEqual(["410 U.S. 113", "347 U.S. 483"]);
  });
});
