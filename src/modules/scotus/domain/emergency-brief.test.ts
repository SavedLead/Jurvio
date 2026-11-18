import { describe, expect, it } from "vitest";
import {
  MID_MODEL, TOP_MODEL, acceptDescription, addSpend, budgetCaps, canSpend, chooseDescriptionLane, compareBriefOrder,
  acceptFilingExcerpt, costUsd, exportCompareSql, exportPacketsSql, filingBacklogCost, filingLinksFromCaseJson, filingLinksFromDocketHtml, inspectCaseJson,
  FILING_CASE_CHAR_CAP, fitFilingsToCase, isSealedFilingText, needsModel, prepareBrief, renderBriefUpsert, routineSummary, teaserPreview,
  type BriefPacketSource, type Spend,
} from "./emergency-brief";

function source(overrides: Partial<BriefPacketSource> = {}): BriefPacketSource {
  return {
    docketNumber: "26A100",
    caption: "Sample v. United States",
    applicant: "United States",
    kind: "stay",
    applicantKind: "federal",
    administration: "Second Trump administration",
    status: "pending",
    lowerCourt: "U.S. Court of Appeals for the Fifth Circuit",
    rulingOn: null,
    ruledBy: null,
    votes: [],
    withheldLines: 0,
    casePublicId: null,
    storedHash: null,
    events: [
      { filedOn: "2026-11-01", kind: "submitted", description: "Application for a stay of the Fifth Circuit's order pending a petition." },
      { filedOn: "2026-11-02", kind: "response_filed", description: "Respondent opposes the stay." },
    ],
    ...overrides,
  };
}

const zero: Spend = { top: 0, mid: 0, teaser: 0, total: 0 };

describe("emergency brief packets", () => {
  it("orders applications newest first", () => {
    const rows = [
      { lastEntryOn: "2026-11-01", docketNumber: "26A2" },
      { lastEntryOn: "2026-11-12", docketNumber: "26A3" },
      { lastEntryOn: null, docketNumber: "26A9" },
      { lastEntryOn: "2026-11-08", docketNumber: "26A1" },
    ].sort(compareBriefOrder);
    expect(rows.map((row) => row.docketNumber)).toEqual(["26A3", "26A1", "26A2", "26A9"]);
  });

  it("uses a template for an extension and Sol for a serious application", () => {
    expect(needsModel(source())).toBe(true);
    expect(needsModel(source({ kind: "extension", applicantKind: "private", administration: null }))).toBe(false);
    const extension = prepareBrief(source({ kind: "extension", applicantKind: "private", administration: null, applicant: "Ada Applicant" }), TOP_MODEL);
    expect(extension.kind).toBe("template");
    if (extension.kind !== "template") return;
    expect(extension.body).toContain("more time");
    expect(extension.body).toContain("26A100");
    expect(extension.body).toContain("taken from the public docket");
    expect(extension.body).not.toContain("model");
    const serious = prepareBrief(source(), MID_MODEL);
    expect(serious.kind).toBe("prompt");
    if (serious.kind !== "prompt") return;
    expect(serious.model.id).toBe("gpt-6.1-sol");
  });

  it("leaves sealed lines out of the prompt and skips a sealed caption", () => {
    const built = prepareBrief(source({
      events: [
        { filedOn: "2026-11-01", kind: "submitted", description: "Application for a stay." },
        { filedOn: "2026-11-02", kind: "letter", description: "Filing is under seal." },
      ],
    }), TOP_MODEL);
    expect(built.kind).toBe("prompt");
    if (built.kind !== "prompt") return;
    expect(built.user).toContain("[line withheld]");
    expect(built.user).not.toContain("under seal");
    expect(prepareBrief(source({ caption: "Sealed matter" }), TOP_MODEL).kind).toBe("restricted");
    expect(routineSummary(source({ caption: "Sealed matter", kind: "extension" }))).toBeNull();
  });

  it("trims a long appendix and keeps the application and the response", () => {
    const built = prepareBrief(source({
      events: [
        { filedOn: "2026-11-01", kind: "submitted", description: "The application asks the Court to pause the injunction." },
        { filedOn: "2026-11-02", kind: "amicus_filed", description: `Appendix ${"A".repeat(20_000)}` },
        { filedOn: "2026-11-03", kind: "response_filed", description: "The other side asks the Court to leave the injunction in place." },
      ],
    }), TOP_MODEL);
    expect(built.kind).toBe("prompt");
    if (built.kind !== "prompt") return;
    expect(built.user).toContain("pause the injunction");
    expect(built.user).toContain("leave the injunction in place");
    expect(built.user.length).toBeLessThan(20_000);
  });

  it("prices Sol as the description model and keeps the teaser reserve", () => {
    expect(costUsd(2, 10, 1_000_000, 1_000_000)).toBe(12);
    const caps = budgetCaps("2026-11-17", {});
    expect(caps).toMatchObject({ topUsd: 0, midUsd: 116, teaserUsd: 2, totalUsd: 118, phase: "credit" });
    expect(chooseDescriptionLane(zero, 1_000, caps, false)).toBe("mid");
    expect(chooseDescriptionLane(zero, 1_000, caps, true)).toBe("mid");
    const descriptionsFull = addSpend(zero, "mid", 116);
    expect(canSpend(descriptionsFull, "mid", 0.01, caps)).toBe(false);
    expect(canSpend(descriptionsFull, "teaser", 0.01, caps)).toBe(true);
    expect(canSpend(addSpend(descriptionsFull, "teaser", 2), "teaser", 0.01, caps)).toBe(false);
    expect(budgetCaps("2026-12-06", {})).toMatchObject({ phase: "after", totalUsd: 0 });
    expect(budgetCaps("2026-12-06", {
      BRIEF_BUDGET_AFTER_TOP_USD: "40", BRIEF_BUDGET_AFTER_MID_USD: "10",
      BRIEF_BUDGET_AFTER_TEASER_USD: "5", BRIEF_BUDGET_AFTER_TOTAL_USD: "50",
    }).totalUsd).toBe(50);
  });

  it("rejects a teaser that mentions a price and labels the preview as unsent", () => {
    const ok = "No. 26A100 is an application by the United States to pause a Fifth Circuit order. The public docket does not say how the Court voted. https://jurvio.com/supreme-court/emergency/26A100";
    expect(acceptDescription(ok, "26A100", "full")).toContain("26A100");
    expect(acceptDescription(`${ok} The filing is under seal.`, "26A100", "full")).toBeNull();
    expect(acceptDescription("No. 26A100 asks the Court for a stay.", "26A100", "teaser")).toContain("26A100");
    expect(acceptDescription("Unlock No. 26A100 for a price.", "26A100", "teaser")).toBeNull();
    const preview = teaserPreview("No. 26A100 asks for a stay.");
    expect(preview.lead).toContain("Here's what we found in your case");
    expect(preview.note).toContain("Nothing was sent");
    expect(preview.note).toContain("Charging is off");
    expect(preview.note).toContain("$19");
  });

  it("keeps a hostile description inside one SQL statement and marks a template as not AI-generated", () => {
    const hash = "a".repeat(64);
    const body = "No. 26A100 stays put. '); DELETE FROM scotus_application_brief; -- $baaaaaaaaaaaaaaaa$";
    const sql = renderBriefUpsert({
      docketNumber: "26A100", briefKind: "routine", body, model: "rule", promptVersion: "emergency-brief-v3",
      sourceHash: hash, inputTokens: 0, outputTokens: 0, costUsd: 0, aiGenerated: false, lane: "description",
      entryCount: 2, lastEntryOn: "2026-11-02", status: "pending", withheldLines: 0,
    });
    expect(sql.match(/INSERT INTO/g)).toHaveLength(1);
    expect(sql).toContain(body);
    expect(sql).toContain("false");
    expect(exportPacketsSql()).toContain("a.last_entry_on DESC");
    expect(exportPacketsSql()).toContain("emergency-brief-v3");
    const compareSql = exportCompareSql();
    expect(compareSql).toContain("kind <> 'extension'");
    expect(compareSql).not.toContain("scotus_application_brief");
    expect(compareSql).not.toContain("scotus_brief_call");
    const messy = exportCompareSql(["24A884", "25A326", "not a docket"]);
    expect(messy).toContain("'24A884'");
    expect(messy).toContain("'25A326'");
    expect(messy).not.toContain("not a docket");
    expect(messy).not.toContain("LIMIT 80");
  });

  it("keeps application, response, reply, and a lower-court opinion, and drops service and outside PDFs", () => {
    const html = `
      <tr><td>Nov 14 2026</td><td>Application (26A686) for a stay of execution, submitted to Justice Thomas.
        <a href= https://www.supremecourt.gov/DocketPDF/26/26A686/1/app.pdf
        class="documentanchor">Main Document</a>
        <a href="https://www.supremecourt.gov/DocketPDF/26/26A686/1/cos.pdf">Proof of Service</a>
        <a href="https://www.supremecourt.gov/DocketPDF/26/26A686/1/opinion.pdf">Lower Court Opinion</a>
        <a href="https://evil.example/app.pdf">Main Document</a>
      </td></tr>
      <tr><td>Nov 17 2026</td><td>Response to application submitted.
        <a href="https://www.supremecourt.gov/DocketPDF/26/26A686/2/resp.pdf">Main Document</a>
      </td></tr>
      <tr><td>Nov 18 2026</td><td>Reply of applicant submitted.
        <a href="https://www.supremecourt.gov/DocketPDF/26/26A686/3/reply.pdf">Main Document</a>
      </td></tr>`;
    expect(filingLinksFromDocketHtml(html).map((link) => link.role)).toEqual(["application", "response", "reply", "lower_court"]);
    const fromJson = filingLinksFromCaseJson({
      ProceedingsandOrder: [
        { Date: "Nov 14 2026", Text: "Application (26A686) for a stay of execution of sentence of death, submitted to Justice Thomas.", Links: [
          { Description: "Main Document", File: "USSC Petition for Stay of Execution.pdf", DocumentUrl: "https://www.supremecourt.gov/DocketPDF/26/26A686/432770/20261114144926816_USSC%20Petition%20for%20Stay%20of%20Execution.pdf" },
          { Description: "Proof of Service", File: "USSC Proof of Service.pdf", DocumentUrl: "https://www.supremecourt.gov/DocketPDF/26/26A686/1/service.pdf" },
          { Description: "Appendix", File: "Lower Court Opinion.pdf", DocumentUrl: "https://www.supremecourt.gov/DocketPDF/26/26A686/1/Lower%20Court%20Opinion.pdf" },
        ] },
        { Date: "Nov 17 2026", Text: "Response to application from respondent Florida, et al. filed.", Links: [
          { Description: "Main Document", File: "26A686- Overton Resp Stay.pdf", DocumentUrl: "https://www.supremecourt.gov/DocketPDF/26/26A686/432951/resp.pdf" },
          { Description: "Certificate of Service", File: "COS.pdf", DocumentUrl: "https://www.supremecourt.gov/DocketPDF/26/26A686/2/cos.pdf" },
        ] },
        { Date: "Nov 18 2026", Text: "Reply of applicant submitted.", Links: [
          { Description: "Main Document", File: "Reply.pdf", DocumentUrl: "https://www.supremecourt.gov/DocketPDF/26/26A686/3/reply.pdf" },
        ] },
      ],
    });
    expect(fromJson.map((link) => link.role)).toEqual(["application", "response", "reply", "lower_court"]);
    const inspected = inspectCaseJson({
      ProceedingsandOrder: [
        { Text: "Application (26A686) for a stay.", Links: [
          { Description: "Main Document", File: "app.pdf", DocumentUrl: "https://www.supremecourt.gov/DocketPDF/26/26A686/1/app.pdf" },
          { Description: "Proof of Service", File: "service.pdf", DocumentUrl: "https://www.supremecourt.gov/DocketPDF/26/26A686/1/service.pdf" },
        ] },
      ],
    });
    expect(inspected.rawLinks).toBe(2);
    expect(inspected.kept.map((link) => link.role)).toEqual(["application"]);
    expect(fromJson.map((link) => link.url).join(" ")).not.toContain("service.pdf");
    expect(fromJson.map((link) => link.url).join(" ")).not.toContain("cos.pdf");
    const built = prepareBrief(source({
      filings: [{ role: "application", url: "https://www.supremecourt.gov/DocketPDF/26/26A686/1/app.pdf", text: "The applicant asks for a stay of execution.", chars: 42, estimatedTokens: 11, trimmed: false, withheld: false }],
    }), TOP_MODEL);
    expect(built.kind).toBe("prompt");
    if (built.kind !== "prompt") return;
    expect(built.user).toContain("The applicant asks for a stay of execution.");
    expect(built.user).not.toContain("cos.pdf");
    const privateCase = prepareBrief(source({
      caption: "Thomas M. Overton v. Florida",
      applicant: "Thomas M. Overton",
      applicantKind: "private",
      administration: "Trump (second term)",
    }), TOP_MODEL);
    expect(privateCase.kind).toBe("prompt");
    if (privateCase.kind === "prompt") expect(privateCase.user).not.toContain("Administration label");
  });

  it("withholds a sealed filing extract and keeps the PDF backlog inside both caps", () => {
    const sealed = acceptFilingExcerpt("This filing is under seal. Do not distribute.", "application", "https://www.supremecourt.gov/DocketPDF/26/26A686/1/app.pdf");
    expect(sealed.withheld).toBe(true);
    expect(sealed.text).toBe("");
    const long = fitFilingsToCase([
      acceptFilingExcerpt("A".repeat(FILING_CASE_CHAR_CAP + 500), "application", "https://www.supremecourt.gov/DocketPDF/26/26A686/1/app.pdf"),
    ]);
    expect(long[0]?.trimmed).toBe(true);
    expect(long[0]?.chars ?? 0).toBeLessThanOrEqual(FILING_CASE_CHAR_CAP + 40);
    expect(isSealedFilingText("FILED UNDER SEAL. The parties may not disclose this appendix.")).toBe(true);
    const publicOpinion = `${"The parents challenge a school policy. ".repeat(30)} The opinion mentions minor students and says the record was not sealed.`;
    expect(isSealedFilingText(publicOpinion)).toBe(false);
    expect(acceptFilingExcerpt(publicOpinion, "lower_court", "https://www.supremecourt.gov/DocketPDF/26/26A701/1/appendix.pdf").withheld).toBe(false);
    const inputTokens = 9_500;
    const ceiling = filingBacklogCost(inputTokens, 2_000);
    expect(ceiling.astraWithinCap).toBe(true);
    expect(ceiling.solWithinCap).toBe(true);
    expect(ceiling.astraTotal).toBeLessThanOrEqual(110);
    expect(ceiling.solTotal).toBeLessThanOrEqual(116);
  });
});
