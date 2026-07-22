import { describe, expect, it } from "vitest";
import { normalizeOpinion, normalizeOpinionCluster } from "./opinion";

describe("CourtListener opinion normalization", () => {
  it("preserves readable citation HTML while removing executable markup", () => {
    const cluster = normalizeOpinionCluster({
      id: 100,
      resource_uri: "/api/rest/v4/clusters/100/",
      absolute_url: "/opinion/100/example/",
      docket: "/api/rest/v4/dockets/50/",
      sub_opinions: ["/api/rest/v4/opinions/200/"],
      case_name: "Example v. Agency",
      date_filed: "2026-06-01",
      citation_count: 12,
      citations: ["123 U.S. 456"],
    });
    const opinion = normalizeOpinion({
      id: 200,
      resource_uri: "/api/rest/v4/opinions/200/",
      cluster: "/api/rest/v4/clusters/100/",
      type: "010-combined-opinion",
      per_curiam: false,
      html_with_citations:
        '<p>The Court relied on <a href="/opinion/1/source/">Source</a>.</p><script>alert(1)</script>',
      html: "",
      html_lawbox: "",
      html_columbia: "",
      html_anon_2020: "",
      xml_harvard: "",
      plain_text: "",
      opinions_cited: [],
    }, cluster);

    expect(opinion.contentHtml).toContain("https://www.courtlistener.com/opinion/1/source/");
    expect(opinion.contentHtml).not.toContain("script");
    expect(opinion.contentText).toBe("The Court relied on Source.");
    expect(opinion.extractionMethod).toBe("courtlistener_html_with_citations");
    expect(opinion.wordCount).toBe(5);
  });

  it("uses escaped plain text when no HTML representation exists", () => {
    const cluster = normalizeOpinionCluster({
      id: 101,
      resource_uri: "/api/rest/v4/clusters/101/",
      absolute_url: "/opinion/101/example/",
      docket: 51,
      sub_opinions: [201],
      case_name: "Example v. Person",
      citation_count: 0,
      citations: [],
    });
    const opinion = normalizeOpinion({
      id: 201,
      resource_uri: "/api/rest/v4/opinions/201/",
      cluster: 101,
      type: "lead-opinion",
      per_curiam: true,
      html_with_citations: "",
      html: "",
      html_lawbox: "",
      html_columbia: "",
      html_anon_2020: "",
      xml_harvard: "",
      plain_text: "A < B & C > D",
      opinions_cited: [],
    }, cluster);

    expect(opinion.contentHtml).toContain("A &lt; B &amp; C &gt; D");
    expect(opinion.contentText).toBe("A &lt; B &amp; C &gt; D");
  });
});
