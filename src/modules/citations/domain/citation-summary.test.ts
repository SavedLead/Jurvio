import { describe, expect, it } from "vitest";
import { citationCountLine, summarizeCitations } from "./citation-summary";
import { linkCaseCitations } from "./link-citations";

describe("citation summary", () => {
  it("counts distinct cases once and every mention separately", () => {
    const text = "See 347 U.S. 483; later 347 U. S. 483 again, and 123 F.3d 456.";
    const summary = summarizeCitations(text, "", new Set(["347us483"]));
    expect(summary).toEqual({
      mentions: 3,
      cases: 2,
      onJurvio: 1,
      notYetOnJurvio: [{ key: "123f3d456", label: "123 F.3d 456" }],
    });
  });

  it("excludes the opinion's own citation and statutes", () => {
    const text = "410 U.S. 113. Under 42 U.S.C. 1983 and 347 U.S. 483.";
    const summary = summarizeCitations(text, "", new Set(), ["410 U. S. 113"]);
    expect(summary.cases).toBe(1);
    expect(summary.notYetOnJurvio.map(c => c.key)).toEqual(["347us483"]);
  });

  it("treats a citation as on Jurvio when its CourtListener cluster is linked", () => {
    const html = '<p><a href="https://www.courtlistener.com/opinion/105221/brown/">347 U.S. 483</a></p>';
    const summary = summarizeCitations("347 U.S. 483", html, new Set(["cl-cluster:105221"]));
    expect(summary.onJurvio).toBe(1);
    expect(summary.notYetOnJurvio).toEqual([]);
  });

  it("writes a plain count line", () => {
    expect(citationCountLine(0, 0)).toBe("No case citations found");
    expect(citationCountLine(1, 1)).toBe("Cites 1 case · all on Jurvio");
    expect(citationCountLine(42, 31)).toBe("Cites 42 cases · 31 on Jurvio");
  });
});

describe("unresolved citation markers", () => {
  const targets = [{ citationKey: "347us483", casePublicId: "jv-brown1234" }];

  it("leaves output unchanged unless marking is requested", () => {
    const html = "<p>347 U.S. 483 and 123 F.3d 456</p>";
    expect(linkCaseCitations(html, targets)).toBe(
      '<p><a href="/case/jv-brown1234" class="jurvioCaseCitation">347 U.S. 483</a> and 123 F.3d 456</p>',
    );
  });

  it("marks citations not yet held, but never the opinion's own citation or text inside links", () => {
    const html = '<p>410 U.S. 113. 347 U.S. 483 and 123 F.3d 456. <a href="/x">99 F.3d 1</a></p>';
    const out = linkCaseCitations(html, targets, { markUnresolved: true, exclude: new Set(["410us113"]) });
    expect(out).toContain('<a href="/case/jv-brown1234" class="jurvioCaseCitation">347 U.S. 483</a>');
    expect(out).toContain('<span class="jurvioCitationPending" title="Not yet on Jurvio">123 F.3d 456</span>');
    expect(out).toContain("<p>410 U.S. 113.");
    expect(out).toContain('<a href="/x">99 F.3d 1</a>');
  });

  it("marks even when nothing on the page is linkable", () => {
    expect(linkCaseCitations("<p>123 F.3d 456</p>", [], { markUnresolved: true })).toContain("jurvioCitationPending");
  });
});
