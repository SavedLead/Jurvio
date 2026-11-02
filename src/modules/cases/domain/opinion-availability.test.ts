import { describe, expect, it } from "vitest";
import { officialOpinionNotice, opinionTextIsPending } from "./opinion-availability";

describe("opinion text availability", () => {
  it("asks for a notice only when no readable opinion is published", () => {
    expect(opinionTextIsPending(false)).toBe(true);
    expect(opinionTextIsPending(true)).toBe(false);
  });

  it("points to the official opinion in reader-facing words", () => {
    const notice = officialOpinionNotice("https://tile.loc.gov/storage-services/service/ll/usrep/usrep384/usrep384436/usrep384436.pdf");
    expect(notice?.heading).toBe("Read the court's full opinion");
    expect(notice?.body).toMatch(/United States Reports/);
    expect(notice?.linkLabel).toBe("Read the official opinion (PDF)");
    for (const text of [notice?.heading, notice?.body, notice?.linkLabel]) {
      expect(text).not.toMatch(/Jurvio|yet|pending|hold|quarantine|draft|verified/i);
    }
  });

  it("shows nothing when there is no official link", () => {
    expect(officialOpinionNotice(null)).toBeNull();
    expect(officialOpinionNotice("javascript:alert(1)")).toBeNull();
  });
});
