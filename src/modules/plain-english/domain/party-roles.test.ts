import { describe, expect, it } from "vitest";
import { captionSides, displayPartyName, readAppealedFrom, readOpinionCaptionRoles, readSupremeRoles, sideForName, trialCaptionRoles } from "./party-roles";

describe("party roles", () => {
  it("reads appellate caption blocks with en-dash and hyphen variants", () => {
    const roles = readOpinionCaptionRoles("No. 19‐3071 YONG JUAN ZHAO, on behalf of her minor son, Plaintiff‐Appellee, v. UNITED STATES OF AMERICA, Defendant‐Appellant. Appeal from …", "Yong Juan Zhao v. USA");
    expect(roles).toMatchObject({ up: { name: "USA", role: "appellant", trialRole: "defendant" }, down: { name: "Yong Juan Zhao", role: "appellee", trialRole: "plaintiff" }, cross: false });
    const petition = readOpinionCaptionRoles("JOSE PEREZ, Petitioner, v. MERRICK B. GARLAND, Attorney General, Respondent. On Petition for Review", "Jose Perez v. Merrick Garland");
    expect(petition).toMatchObject({ up: { name: "Jose Perez", role: "petitioner" }, down: { role: "respondent" } });
  });

  it("refuses when the block does not match the caption or roles are not opposite", () => {
    expect(readOpinionCaptionRoles("SMITH, Appellant, v. JONES, Appellee.", "Brown v. Green")).toBeNull();
    expect(readOpinionCaptionRoles("SMITH, Appellant, v. JONES, Appellant.", "Smith v. Jones")).toBeNull();
    expect(readOpinionCaptionRoles(null, "Smith v. Jones")).toBeNull();
  });

  it("reads the Supreme Court's certiorari line", () => {
    const { roles, lowerCourt } = readSupremeRoles("CERTIORARI TO THE UNITED STATES COURT OF APPEALS FOR THE NINTH CIRCUIT No. 22-1", "Ohio v. EPA", false);
    expect(roles).toMatchObject({ up: { name: "Ohio", role: "petitioner" }, down: { name: "EPA", role: "respondent" } });
    expect(lowerCourt).toBe("the United States Court of Appeals for the Ninth Circuit");
    expect(readSupremeRoles("APPEAL FROM THE UNITED STATES DISTRICT COURT FOR THE DISTRICT OF KANSAS", "Brown v. Board of Education", false).roles?.up.role).toBe("appellant");
    expect(readSupremeRoles("", "Brown v. Board of Education", false).roles).toBeNull();
  });

  it("reads where an appeal came from", () => {
    expect(readAppealedFrom("Appeal from the United States District Court for the Southern District of Illinois. No. 3:17")).toBe("the United States District Court for the Southern District of Illinois");
  });

  it("maps trial captions and names", () => {
    expect(trialCaptionRoles("USA v. Doe")?.up.role).toBe("prosecution");
    expect(captionSides("In re Smith")).toBeNull();
    expect(displayPartyName("USA")).toBe("the United States");
    expect(displayPartyName("Brown et al.")).toBe("Brown and others");
    const roles = trialCaptionRoles("Jane Doe v. Acme Corp.")!;
    expect(sideForName(roles, "Acme Corp.")).toBe("down");
    expect(sideForName(roles, "Plaintiff")).toBe("up");
    expect(sideForName(roles, "John Roe")).toBeNull();
  });
});
