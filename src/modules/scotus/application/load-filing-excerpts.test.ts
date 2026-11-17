import { afterEach, describe, expect, it, vi } from "vitest";
import { loadFilingExcerpts } from "./load-filing-excerpts";

const miniPdf = new TextEncoder().encode(`%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 68>>stream
BT /F1 18 Tf 36 100 Td (Hello stay 26A686) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF
`);

const caseJson = {
  ProceedingsandOrder: [
    {
      Text: "Application (26A686) for a stay of execution, submitted to Justice Thomas.",
      Links: [
        { Description: "Main Document", File: "Stay.pdf", DocumentUrl: "https://www.supremecourt.gov/DocketPDF/26/26A686/1/stay.pdf" },
        { Description: "Proof of Service", File: "Service.pdf", DocumentUrl: "https://www.supremecourt.gov/DocketPDF/26/26A686/1/service.pdf" },
      ],
    },
  ],
};

function jsonResponse(body: unknown, status = 200) {
  const text = JSON.stringify(body);
  return new Response(text, { status, headers: { "content-type": "application/json" } });
}

describe("loadFilingExcerpts", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the case JSON and the main-document PDF", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith(".json")) return jsonResponse(caseJson);
      return new Response(miniPdf, { status: 200, headers: { "content-type": "application/pdf" } });
    });
    const loaded = await loadFilingExcerpts("26A686", { fetch: fetchMock, gapMs: 0, now: () => 1_000 });
    expect(loaded.httpStatus).toBe(200);
    expect(loaded.bytes).toBeGreaterThan(0);
    expect(loaded.rawLinks).toBe(2);
    expect(loaded.keptLinks).toBe(1);
    expect(loaded.filings).toHaveLength(1);
    expect(loaded.filings[0]?.chars).toBeGreaterThan(0);
    expect(loaded.pdfs[0]).toMatchObject({ role: "application", httpStatus: 200 });
    expect(loaded.pdfs[0]?.bytes).toBe(miniPdf.byteLength);
    expect(loaded.blocked).toBe(false);
    expect(loaded.note ?? "").not.toContain("before initialization");
    expect(fetchMock).toHaveBeenCalled();
  });

  it("marks a real HTTP failure as blocked and a programming error as not blocked", async () => {
    const denied = await loadFilingExcerpts("26A686", {
      fetch: vi.fn(async () => new Response("no", { status: 403, headers: { "content-type": "text/html" } })),
      gapMs: 0,
      now: () => 2_000,
    });
    expect(denied.httpStatus).toBe(403);
    expect(denied.blocked).toBe(true);
    expect(denied.filings).toHaveLength(0);

    const programming = await loadFilingExcerpts("26A686", {
      fetch: vi.fn(async () => {
        throw new ReferenceError("Cannot access 'REQUEST_GAP_MS' before initialization");
      }),
      gapMs: 0,
      now: () => 3_000,
    });
    expect(programming.httpStatus).toBeNull();
    expect(programming.blocked).toBe(false);
    expect(programming.note).toContain("before initialization");

    const network = await loadFilingExcerpts("26A686", {
      fetch: vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
      gapMs: 0,
      now: () => 4_000,
    });
    expect(network.blocked).toBe(true);
    expect(network.httpStatus).toBeNull();
  });
});
