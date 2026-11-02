import { describe, expect, it } from "vitest";
import {
  docketSentences,
  entryContext,
  justiceRefs,
  openingOfOpinion,
  parseDocketJusticeNotes,
  resolveJustice,
  type RosterJustice,
} from "./docket-justice-notes";

const kinds = (entry: string) => parseDocketJusticeNotes(entry).map((note) => `${note.justiceRef}:${note.kind}`);

describe("parseDocketJusticeNotes", () => {
  it("reads a would-grant and a written dissent from a cert denial (No. 24-57)", () => {
    const entry = "Petition DENIED. Justice Alito would grant the petition for a writ of certiorari. Justice Thomas, dissenting from the denial of certiorari. (Detached Opinion)";
    expect(kinds(entry)).toEqual(["Alito:would_grant", "Thomas:dissent"]);
    expect(parseDocketJusticeNotes(entry)[0]?.context).toBe("cert_denied");
  });

  it("reads joiners of a dissent", () => {
    const entry = "Petition DENIED. Justice Sotomayor, with whom Justice Kagan and Justice Jackson join, dissenting from the denial of certiorari. (Detached Opinion)";
    expect(kinds(entry)).toEqual(["Sotomayor:dissent", "Kagan:joined_dissent", "Jackson:joined_dissent"]);
  });

  it("reads statements respecting the denial, and The Chief Justice", () => {
    expect(kinds("Petition DENIED. Statement of Justice Sotomayor respecting the denial of certiorari. (Detached Opinion)")).toEqual(["Sotomayor:statement"]);
    expect(kinds("Petition DENIED. The Chief Justice took no part in the consideration or decision of this petition.")).toEqual(["The Chief Justice:recused"]);
    expect(kinds("Petition DENIED. Statement of Justice Kavanaugh, with whom Justice Barrett joins, respecting the denial of certiorari.")).toEqual(["Kavanaugh:statement", "Barrett:joined_statement"]);
  });

  it("reads several justices who would grant, and a concurrence in the denial", () => {
    expect(kinds("Petition DENIED. Justice Thomas, Justice Alito, and Justice Gorsuch would grant the petition for a writ of certiorari.")).toEqual(["Thomas:would_grant", "Alito:would_grant", "Gorsuch:would_grant"]);
    expect(kinds("Petition DENIED. Justice Thomas and Justice Gorsuch would grant the petition.")).toEqual(["Thomas:would_grant", "Gorsuch:would_grant"]);
    expect(kinds("Petition DENIED. Justices Thomas and Alito would grant the petition.")).toEqual(["Thomas:would_grant", "Alito:would_grant"]);
    expect(kinds("Petition DENIED. Justice Kavanaugh, concurring in the denial of certiorari. (Detached Opinion)")).toEqual(["Kavanaugh:concurrence"]);
  });

  it("reads 'would deny' on a granted petition and application orders", () => {
    const granted = parseDocketJusticeNotes("Petition GRANTED. Justice Sotomayor would deny the petition.");
    expect(granted.map((note) => `${note.justiceRef}:${note.kind}:${note.context}`)).toEqual(["Sotomayor:would_deny:cert_granted"]);
    const app = parseDocketJusticeNotes("Application (24A123) denied by the Court. Justice Gorsuch would grant the application.");
    expect(app.map((note) => `${note.justiceRef}:${note.kind}:${note.context}`)).toEqual(["Gorsuch:would_grant:application"]);
  });

  it("returns nothing for plain denials and other docket text", () => {
    expect(parseDocketJusticeNotes("Petition DENIED.")).toEqual([]);
    expect(parseDocketJusticeNotes("DISTRIBUTED for Conference of 1/10/2025.")).toEqual([]);
    expect(parseDocketJusticeNotes("Application (24A5) granted by Justice Kavanaugh extending the time to file until March 1, 2025.")).toEqual([]);
  });
});

describe("helpers", () => {
  it("splits sentences without breaking case names", () => {
    expect(docketSentences("Petition DENIED. Justice Thomas, dissenting from the denial in Smith v. Jones. Justice Alito would grant the petition.")).toHaveLength(3);
  });
  it("names justices", () => {
    expect(justiceRefs("Justice Thomas, Justice Alito, and Justice Gorsuch")).toEqual(["Thomas", "Alito", "Gorsuch"]);
    expect(justiceRefs("The Chief Justice and Justice Kavanaugh")).toEqual(["The Chief Justice", "Kavanaugh"]);
  });
  it("classifies entries", () => {
    expect(entryContext("Rehearing DENIED. Justice Thomas would grant the petition for rehearing.")).toBe("rehearing");
    expect(entryContext("Petition GRANTED.")).toBe("cert_granted");
  });
});

describe("openingOfOpinion", () => {
  const pdf = [
    "Cite as: 604 U. S. ____ (2025)  1",
    "THOMAS, J., dissenting",
    "SUPREME COURT OF THE UNITED STATES",
    "COALITION LIFE v. CITY OF CARBONDALE, ILLINOIS",
    "No. 24–57. Decided February 24, 2025",
    "The petition for a writ of certiorari is denied. JUSTICE",
    "ALITO would grant the petition for a writ of certiorari.",
    "JUSTICE THOMAS, dissenting from the denial of certiorari.",
    "In Hill v. Colorado, 530 U. S. 703 (2000), this Court up-",
    "held a state law restricting peaceful speech within 100 feet",
    "of abortion clinics. Lower courts continue to feel bound by it.",
    "I respectfully dissent.",
    "I",
    "Hill involved a 1993 Colorado statute.",
  ].join("\n");
  it("quotes the opening of the dissent", () => {
    expect(openingOfOpinion(pdf, "Thomas", "dissent")).toBe("In Hill v. Colorado, 530 U. S. 703 (2000), this Court upheld a state law restricting peaceful speech within 100 feet of abortion clinics. Lower courts continue to feel bound by it. I respectfully dissent.");
  });
  it("returns null when the heading is not found", () => {
    expect(openingOfOpinion(pdf, "Kagan", "dissent")).toBeNull();
  });
  it("reads a statement", () => {
    const text = "Statement of JUSTICE SOTOMAYOR respecting the denial of certiorari.\nThe petitioner was sentenced to death after a trial in which the jury never heard evidence of his intellectual disability. I write to explain why.";
    expect(openingOfOpinion(text, "Sotomayor", "statement")).toMatch(/^The petitioner was sentenced/);
  });
});

describe("resolveJustice", () => {
  const roster: RosterJustice[] = [
    { scdbJusticeId: 102, displayName: "William Hubbs Rehnquist", surname: "Rehnquist", slug: "william-hubbs-rehnquist", serviceStart: "1972-01-07", serviceEnd: "2005-09-03", chiefFrom: "1986-09-25", chiefTo: "2005-09-03" },
    { scdbJusticeId: 111, displayName: "John Glover Roberts, Jr.", surname: "Roberts", slug: "john-glover-roberts-jr", serviceStart: "2005-09-29", serviceEnd: null, chiefFrom: "2005-09-29", chiefTo: null },
    { scdbJusticeId: 112, displayName: "Samuel A. Alito, Jr.", surname: "Alito", slug: "samuel-a-alito-jr", serviceStart: "2006-01-31", serviceEnd: null, chiefFrom: null, chiefTo: null },
  ];
  it("resolves by surname and service dates", () => {
    expect(resolveJustice("Alito", "2025-02-24", roster)?.scdbJusticeId).toBe(112);
    expect(resolveJustice("Alito", "2004-01-01", roster)).toBeNull();
    expect(resolveJustice("The Chief Justice", "2004-01-01", roster)?.scdbJusticeId).toBe(102);
    expect(resolveJustice("The Chief Justice", "2025-02-24", roster)?.scdbJusticeId).toBe(111);
  });
});

describe("real docket entries", () => {
  it("splits after a detached-opinion marker (No. 24-203, Snope v. Brown)", () => {
    expect(kinds("Petition DENIED. Justice Alito and Justice Gorsuch would grant the petition for a writ of certiorari. Statement of Justice Kavanaugh respecting the denial of certiorari. (Detached Opinion ) Justice Thomas, dissenting from the denial of certiorari. (Detached Opinion )"))
      .toEqual(["Alito:would_grant", "Gorsuch:would_grant", "Kavanaugh:statement", "Thomas:dissent"]);
  });
  it("reads a recusal and a joined dissent (No. 24-291)", () => {
    expect(kinds("Petition DENIED. Justice Alito took no part in the consideration or decision of this petition. Justice Gorsuch, with whom Justice Thomas joins, dissenting from the denial of certiorari. (Detached Opinion )"))
      .toEqual(["Alito:recused", "Gorsuch:dissent", "Thomas:joined_dissent"]);
  });
  it("reads a dissent from a summary reversal (No. 23-6573)", () => {
    const notes = parseDocketJusticeNotes("Petition for a writ of certiorari and motion for leave to proceed in forma pauperis GRANTED. Judgment VACATED and case REMANDED. Opinion per curiam. (Detached Opinion) Justice Thomas, with whom Justice Gorsuch joins, dissenting. (Detached Opinion)");
    expect(notes.map((note) => `${note.justiceRef}:${note.kind}:${note.context}`)).toEqual(["Thomas:dissent:cert_granted", "Gorsuch:joined_dissent:cert_granted"]);
  });
});
