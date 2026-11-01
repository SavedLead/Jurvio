import { describe, expect, it } from "vitest";
import { glossaryTerms } from "@/modules/explainers/domain/glossary";
import { glossaryAdditions } from "@/modules/explainers/domain/glossary-additions";
import { labelsForTerms, segmentTerms, termIndex, termKey, termsInText, type TermSegment } from "./term-index";

const marked = (segments: TermSegment[]) =>
  segments.filter((segment): segment is Exclude<TermSegment, string> => typeof segment !== "string")
    .map((segment) => [segment.text, segment.term.key]);

describe("plain-English term index", () => {
  it("covers the terms David listed", () => {
    const text = "The claims were dismissed with prejudice; others without prejudice. The court affirmed, reversed, remanded, and vacated. Certiorari. Summary judgment. Per curiam.";
    expect(marked(segmentTerms(text, new Set()))).toEqual([
      ["dismissed with prejudice", "dismissed-with-prejudice"],
      ["without prejudice", "dismissed-without-prejudice"],
      ["affirmed", "affirmed"],
      ["reversed", "reversed"],
      ["remanded", "remand"],
      ["vacated", "vacated"],
      ["Certiorari", "certiorari"],
      ["Summary judgment", "summary-judgment"],
      ["Per curiam", "per-curiam"],
    ]);
  });

  it("prefers the longest match and marks only the first occurrence per section", () => {
    const seen = new Set<string>();
    expect(marked(segmentTerms("Petition for a writ of certiorari granted. Certiorari.", seen))).toEqual([
      ["Petition for a writ of certiorari", "petition-for-certiorari"],
      ["Certiorari", "certiorari"],
    ]);
    expect(marked(segmentTerms("Summary judgment, then summary judgment again.", seen))).toEqual([["Summary judgment", "summary-judgment"]]);
    // Same section marker: already-marked terms stay plain.
    expect(marked(segmentTerms("Certiorari and summary judgment.", seen))).toEqual([]);
  });

  it("matches whole words only and keeps the original text", () => {
    const text = "The prosecutor reaffirmed her plan; nonaffirmed items; the TRO issued; a tro lowercase.";
    const segments = segmentTerms(text, new Set());
    expect(segments.map((segment) => (typeof segment === "string" ? segment : segment.text)).join("")).toBe(text);
    expect(marked(segments)).toEqual([["TRO", "temporary-restraining-order"]]);
  });

  it("does not underline everyday words", () => {
    const text = "The plaintiff filed a complaint and a motion; the judge issued an order after a hearing and trial.";
    expect(marked(segmentTerms(text, new Set()))).toEqual([]);
  });

  it("links to the deep explainer when one exists, else to the dictionary entry anchor", () => {
    const { terms } = termIndex();
    expect(terms.get("affirmed")?.href).toBe("/explainers/affirmed");
    expect(terms.get("dismissed-with-prejudice")?.href).toBe("/explainers/dismissal-with-or-without-prejudice");
    expect(terms.get("certiorari")?.href).toBe("/explainers/writ-of-certiorari");
    expect(terms.get("en-banc")?.href).toBe("/explainers#term-en-banc");
    expect(terms.get("appellee")?.href).toBe("/explainers#term-appellee");
  });

  it("every dictionary link target exists", () => {
    const anchors = new Set([...glossaryTerms, ...glossaryAdditions].map((item) => `/explainers#term-${termKey(item.term)}`));
    for (const term of termIndex().terms.values()) {
      if (term.href.includes("#")) expect(anchors.has(term.href)).toBe(true);
      expect(term.definition.length).toBeGreaterThan(10);
    }
  });

  it("returns only the terms present, with labels for client matching", () => {
    const found = termsInText("Remanded for further proceedings. The appellant argued habeas relief.");
    expect(found.map((term) => term.key).sort()).toEqual(["appellant", "habeas-corpus", "remand"]);
    const labels = labelsForTerms(new Set(["temporary-restraining-order"]));
    expect(labels).toContainEqual(["tro", "temporary-restraining-order", "TRO"]);
  });

  it("scans a long opinion quickly", () => {
    const paragraph = "The district court granted summary judgment for the appellee, and we affirm in part, reverse in part, and remand. ".repeat(4);
    const opinion = `${paragraph} Lorem ipsum dolor sit amet, consectetur adipiscing elit. `.repeat(1500); // ~150k words
    termIndex();
    const started = performance.now();
    termsInText(opinion);
    expect(performance.now() - started).toBeLessThan(1500);
  });
});
