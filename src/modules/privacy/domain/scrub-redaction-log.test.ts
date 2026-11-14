import { describe, expect, it } from "vitest";
import { scrubRedactionLog } from "./scrub-redaction-log";

describe("scrubRedactionLog", () => {
  it("removes a subject, a name part, and a contact address from an error", () => {
    const raw = [
      "canceling statement due to statement timeout",
      "parameter $1 = 'Ada Lovelace'",
      "websearch_to_tsquery Ada",
      "contact ada.lovelace@example.com",
    ].join("\n");
    const scrubbed = scrubRedactionLog(raw, ["Ada Lovelace"]);
    expect(scrubbed).not.toMatch(/ada/i);
    expect(scrubbed).not.toMatch(/lovelace/i);
    expect(scrubbed).not.toContain("@");
    expect(scrubbed).toContain("canceling statement due to statement timeout");
    expect(scrubbed).toContain("[redacted]");
  });
});
