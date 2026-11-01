import { describe, expect, it } from "vitest";
import { buildDigestEmail, isDue } from "./alerts";

describe("alert cadence and digest email", () => {
  const now = new Date("2026-11-01T12:00:00Z");
  it("is due by plan cadence", () => {
    expect(isDue("daily", null, now)).toBe(true);
    expect(isDue("daily", new Date("2026-10-31T13:00:00Z"), now)).toBe(false);
    expect(isDue("daily", new Date("2026-10-31T12:01:00Z"), now)).toBe(true);
    expect(isDue("hourly", new Date("2026-11-01T11:30:00Z"), now)).toBe(false);
    expect(isDue("hourly", new Date("2026-11-01T11:00:00Z"), now)).toBe(true);
    expect(isDue("instant", new Date("2026-11-01T11:51:00Z"), now)).toBe(true);
  });

  it("groups entries by case with unsubscribe link and postal address, escaping html", () => {
    const entries = Array.from({ length: 12 }, (_, i) => ({
      casePublicId: "jv-a", caption: "Acme <Corp> v. Beta", docketNumber: "1:26-cv-1", courtName: "S.D.N.Y.",
      entryNumber: String(i + 1), filedOn: "2026-10-31", description: `Order ${i + 1}`,
    }));
    entries.push({ casePublicId: "jv-b", caption: "Gamma v. Delta", docketNumber: "26-100", courtName: null, entryNumber: null, filedOn: null, description: "Brief filed" });
    const email = buildDigestEmail({ entries, siteUrl: "https://jurvio.com", unsubscribeToken: "ab".repeat(24), postalAddress: "Jurvio, 1 Main St, New York, NY 10001", cadence: "daily" });
    expect(email.subject).toBe("13 new docket entries in 2 cases you follow");
    expect(email.text).toContain("https://jurvio.com/case/jv-a/docket");
    expect(email.text).toContain("- and 2 more");
    expect(email.text).toContain(`https://jurvio.com/alerts/unsubscribe?token=${"ab".repeat(24)}`);
    expect(email.text).toContain("Jurvio, 1 Main St, New York, NY 10001");
    expect(email.html).toContain("Acme &lt;Corp&gt; v. Beta");
    expect(email.html).not.toContain("<Corp>");
  });
});
