import { describe, expect, it } from "vitest";
import { textFromPdfBytes } from "./filing-pdf-text";

const miniPdf = new TextEncoder().encode(`%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 68>>stream
BT /F1 18 Tf 36 100 Td (Hello stay 26A100) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF
`);

describe("filing PDF text", () => {
  it("reads text from a PDF and skips bytes that are not a readable PDF", async () => {
    await expect(textFromPdfBytes(miniPdf)).resolves.toContain("Hello stay 26A100");
    await expect(textFromPdfBytes(new Uint8Array())).resolves.toBeNull();
    await expect(textFromPdfBytes(new TextEncoder().encode("not a pdf"))).resolves.toBeNull();
  });
});
