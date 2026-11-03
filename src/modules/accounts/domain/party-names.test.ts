import { describe, expect, it } from "vitest";
import { captionNamesParty, cleanPartyName, isFollowablePartyName, partiesFromCaption, partyCaptionMatchSql, partyKey } from "./party-names";

describe("party names", () => {
  it("splits captions into followable sides", () => {
    expect(partiesFromCaption("Michael Pina, Petitioner v. Estate of Jacob Dominguez, et al.")).toEqual(["Michael Pina", "Estate of Jacob Dominguez"]);
    expect(partiesFromCaption("303 Creative LLC v. Elenis")).toEqual(["303 Creative LLC", "Elenis"]);
    expect(partiesFromCaption("USA v. Corwise")).toEqual(["Corwise"]);
    expect(partiesFromCaption("In re: Acme Widgets Inc.")).toEqual(["Acme Widgets Inc."]);
    expect(partiesFromCaption("Shrem vs. Experian Information Solutions, Inc.")).toEqual(["Shrem", "Experian Information Solutions, Inc."]);
  });
  it("never offers anonymised or protected parties", () => {
    expect(partiesFromCaption("Doe v. Acme Corp.")).toEqual(["Acme Corp."]);
    expect(partiesFromCaption("SEALED v. SEALED")).toEqual([]);
    expect(partiesFromCaption("J.D. v. Unknown Agents")).toEqual([]);
    expect(isFollowablePartyName("A.B.")).toBe(false);
    expect(isFollowablePartyName("Jane Roe")).toBe(false);
    expect(isFollowablePartyName("Juvenile Male")).toBe(false);
    expect(isFollowablePartyName("Experian")).toBe(true);
  });
  it("normalizes names and matches whole words", () => {
    expect(partyKey("Experian Information Solutions, Inc.")).toBe("experian information solutions inc");
    expect(cleanPartyName("Acme Corp. et al")).toBe("Acme Corp.");
    expect(captionNamesParty("Shrem v. Experian Information Solutions, Inc.", "experian")).toBe(true);
    expect(captionNamesParty("Shrem v. Experiantial LLC", "experian")).toBe(false);
  });
  it("builds column-only SQL", () => {
    expect(partyCaptionMatchSql("c.caption", "f.target_key")).toContain("LIKE");
    expect(() => partyCaptionMatchSql("c.caption; drop", "f.target_key")).toThrow();
  });
});
