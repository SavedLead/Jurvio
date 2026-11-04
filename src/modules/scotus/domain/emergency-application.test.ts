import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseApplicationPage, isWithheldLine } from "@/modules/ingestion/live-feeds/scotus-emergency";
import { classifyEvent } from "@/modules/ingestion/providers/scotus/official-docket";
import {
  EMERGENCY_FEEDS, EMERGENCY_TIMING_NOTE, classifyApplicant, classifyApplicationEvent, classifyApplicationKind, deriveApplicationState,
  emergencyFeedBySlug, emergencyFeedConditionSql, expectedJusticeFor, normalizeApplicationNumber, parseResponseDue, parseResponseExtension, pollTier, responseDisplay, responseStatusFrom, submittedJustice,
} from "./emergency-application";

// Real supremecourt.gov docket pages (Nov 2026), counsel contact blocks removed.
const fixture = (name: string) => readFileSync(join(__dirname, "..", "fixtures", "emergency", `${name}.html`), "utf8");

describe("emergency application docket lines", () => {
  it.each([
    ["Application (26A624) for injunction pending appeal, submitted to Justice Kagan.", "submitted"],
    ["Application (26A624) referred to the Court.", "referred"],
    ["Response to application (24A904) requested by Justice Kagan, due by 12 p.m. (EDT) on April 3, 2025.", "response_requested"],
    ["Administrative stay entered by The Chief Justice. Response due by 5 p.m. (EST) on November 6, 2026.", "administrative_stay"],
    ["Response to application from respondent Florida filed.", "response_filed"],
    ["Reply of applicant Jesse Guardado filed.", "reply_filed"],
    ["Application (26A624) for injunction pending appeal, presented to Justice Kagan and by her referred to the Court is denied.", "denied"],
    ["Application (26A600) granted by Justice Thomas extending the time to file until January 26, 2027.", "granted"],
    ["Brief amicus curiae of Former Judges filed.", "amicus_filed"],
  ] as const)("%s -> %s", (line, kind) => {
    expect(classifyApplicationEvent(line)).toBe(kind);
  });

  it("gives the official-docket lane the new application event types", () => {
    expect(classifyEvent("Application (26A624) referred to the Court.")).toBe("application_referred");
    expect(classifyEvent("Response to application (24A904) requested by Justice Kagan, due by 12 p.m. (EDT) on April 3, 2025.")).toBe("response_requested");
    expect(classifyEvent("Administrative stay entered by Justice Alito.")).toBe("administrative_stay");
  });

  it("reads response deadlines and justices", () => {
    expect(parseResponseDue("Response to application (24A904) requested by Justice Kagan, due by 12 p.m. (EDT) on April 3, 2025."))
      .toEqual({ dueOn: "2025-04-03", dueText: "12 p.m. (EDT) on April 3, 2025", justice: "Kagan" });
    expect(submittedJustice("Application (26A1) for a stay, submitted to The Chief Justice.")).toBe("The Chief Justice");
    expect(expectedJusticeFor("United States Court of Appeals for the Ninth Circuit")?.justiceRef).toBe("Kagan");
    expect(normalizeApplicationNumber("26a0624")).toBe("26A624");
  });

  it("classifies the kind of request and who asked", () => {
    expect(classifyApplicationKind("Application (26A600) to extend the time to file a petition for a writ of certiorari from December 1, 2026 to January 26, 2027, submitted to Justice Thomas.")).toBe("extension");
    expect(classifyApplicationKind("Application (26A623) for a stay of execution of sentence of death, submitted to Justice Thomas.", true)).toBe("stay_of_execution");
    expect(classifyApplicant("United States", true)).toBe("federal");
    expect(classifyApplicant("South Carolina, et al.")).toBe("state");
    expect(classifyApplicant("Jesse Guardado")).toBe("private");
  });
});

describe("emergency application pages", () => {
  it("derives a federal application referred to and denied by the full Court", () => {
    const page = parseApplicationPage(fixture("26a624"), "26A624");
    const state = deriveApplicationState(page.lines, { capital: page.capital });
    expect(page.caption).toBe("United States v. California, et al.");
    expect(classifyApplicant(page.applicant, page.solicitorGeneral)).toBe("federal");
    expect(classifyApplicationKind(page.lines[0]?.description)).toBe("injunction");
    expect(state).toMatchObject({ status: "denied", referredOn: "2026-11-02", rulingOn: "2026-11-02", ruledBy: "court" });
    expect(state.events.map((event) => event.kind)).toEqual(["submitted", "referred", "denied"]);
  });

  it("keeps the response deadline and the publicly noted vote", () => {
    const page = parseApplicationPage(fixture("24a904"), "24A904");
    const state = deriveApplicationState(page.lines);
    expect(state.responseDueOn).toBe("2025-04-03");
    expect(state.status).toBe("granted");
    expect(state.notedVotes).toEqual([expect.objectContaining({ justiceRef: "Sotomayor", position: "would_deny" })]);
  });

  it("treats a response filed on the deadline as met (26A458: due Oct 13, responses filed Oct 13)", () => {
    const page = parseApplicationPage(fixture("26a458"), "26A458");
    const state = deriveApplicationState(page.lines);
    expect(state).toMatchObject({ status: "pending", responseDueOn: "2026-10-13", responseFiledOn: "2026-10-13", responseRequestedBy: "Kagan" });
    expect(responseDisplay(state, "2026-11-04")).toEqual({ state: "filed", on: "2026-10-13" });
  });

  it("never shows a past deadline as due", () => {
    const pending = { status: "pending" as const, responseFiledOn: null };
    expect(responseDisplay({ ...pending, responseDueOn: "2026-10-13" }, "2026-11-04")).toEqual({ state: "passed", on: "2026-10-13" });
    expect(responseDisplay({ ...pending, responseDueOn: "2026-11-04" }, "2026-11-04")).toEqual({ state: "due", on: "2026-11-04", days: 0 });
    expect(responseDisplay({ ...pending, responseDueOn: "2026-11-06" }, "2026-11-04")).toEqual({ state: "due", on: "2026-11-06", days: 2 });
    expect(responseDisplay({ status: "denied", responseFiledOn: null, responseDueOn: "2026-11-06" }, "2026-11-04")).toBeNull();
  });

  it("honors granted extensions and newer requests, and ignores responses filed before a new request", () => {
    expect(parseResponseExtension("Motion to extend the time to file a response is granted and the time is extended to and including November 20, 2026.")).toEqual({ dueOn: "2026-11-20", dueText: "November 20, 2026" });
    expect(parseResponseExtension("Response due date extended to 5 p.m. (EST) on November 20, 2026.")).toMatchObject({ dueOn: "2026-11-20" });
    expect(parseResponseExtension("Motion to extend the time to file a response from November 6, 2026 to November 20, 2026, submitted to The Clerk.")).toBeNull();
    expect(parseResponseExtension("Motion to extend the time to file a response is denied.")).toBeNull();
    const request = (on: string, due: string) => ({ filedOn: on, description: `Response to application (26A1) requested by Justice Kagan, due by 4 p.m. (EST) on ${due}.` });
    const filed = (on: string) => ({ filedOn: on, description: "Response to application from respondent Ohio filed." });
    expect(responseStatusFrom([request("2026-10-01", "October 8, 2026"),
      { filedOn: "2026-10-03", description: "Motion to extend the time to file a response is granted and the time is extended to and including October 15, 2026." }]))
      .toMatchObject({ dueOn: "2026-10-15", filedOn: null });
    expect(responseStatusFrom([request("2026-10-01", "October 8, 2026"), filed("2026-10-08"), request("2026-10-20", "October 27, 2026")]))
      .toMatchObject({ dueOn: "2026-10-27", filedOn: null });
    expect(responseStatusFrom([filed("2026-09-30"), request("2026-10-01", "October 8, 2026")])).toMatchObject({ dueOn: "2026-10-08", filedOn: null });
  });

  it("reads response, ruling and deadline lines the first parser missed (audit, Nov 4 2026)", () => {
    // "et al." used to end the sentence match, so these responses were not seen.
    expect(classifyApplicationEvent("Response to application from respondent Moshe Bain, et al. filed.")).toBe("response_filed");
    expect(classifyApplicationEvent("Response to application from respondent Friends of the Ruidosa Church, et al. filed.")).toBe("response_filed");
    // 26A382: a single justice's ruling written as an order.
    expect(classifyApplicationEvent("Order entered by Justice Sotomayor: Upon consideration of the application of counsel for the applicants and the response filed thereto, it is ordered that the application for stay is denied without prejudice to applicants again seeking relief, if necessary, once state court remedies are exhausted.")).toBe("denied");
    // 25A810: the full Court granted part and denied the rest.
    expect(classifyApplicationEvent("The application to vacate the Ninth Circuit's stay presented to Justice Kagan and by her referred to the Court is granted as to the parents but is otherwise denied. Opinion per curiam.")).toBe("granted_in_part");
    expect(classifyApplicationEvent("The application for stay presented to Justice Alito and by him referred to the Court is denied.")).toBe("denied");
    expect(classifyApplicationEvent("Application (26A624) referred to the Court.")).toBe("referred");
    // A comma after the time zone used to lose the deadline.
    expect(parseResponseDue("Response to application (25A810) requested by Justice Kagan, due by 4 p.m. (EST), on January 21, 2026.")).toMatchObject({ dueOn: "2026-01-21", justice: "Kagan" });
    // An administrative stay order is still an administrative stay.
    expect(classifyApplicationEvent("Order entered by Justice Alito: Upon consideration of the application, it is ordered that the mandate is stayed pending further order of the undersigned.")).toBe("administrative_stay");
  });

  it("marks capital cases and linked dockets", () => {
    const page = parseApplicationPage(fixture("26a623"), "26A623");
    expect(page.capital).toBe(true);
    expect(page.linkedDocket).toBe("26-6013");
    expect(deriveApplicationState(page.lines, { capital: true }).status).toBe("pending");
  });

  it("does not take the Solicitor General as applicant when it only represents the respondent", () => {
    const page = parseApplicationPage(fixture("26a600"), "26A600");
    expect(page.solicitorGeneral).toBe(false);
    expect(classifyApplicationKind(page.lines[0]?.description)).toBe("extension");
  });

  it("withholds every line that mentions sealed material (the filter is not relaxed)", () => {
    const page = parseApplicationPage(fixture("25a234"), "25A234");
    expect(page.withheldLines).toBe(2);
    for (const line of page.lines) expect(isWithheldLine(line.description)).toBe(false);
    expect(page.lines.some((line) => /seal|redact/i.test(line.description))).toBe(false);
    expect(isWithheldLine("Motion for leave to file a document under seal with redacted copies for the public record filed.")).toBe(true);
    expect(isWithheldLine("Application granted. The petition involves a juvenile.")).toBe(true);
  });
});

describe("polling tiers and feeds", () => {
  const base = { kind: "stay" as const, status: "pending" as const, adminStayOn: null, responseDueOn: null, rulingOn: null };
  it("polls open serious applications every run and quiet or decided ones daily", () => {
    expect(pollTier(base, "2026-11-04")).toBe("open");
    expect(pollTier({ ...base, adminStayOn: "2026-11-03" }, "2026-11-04")).toBe("hot");
    expect(pollTier({ ...base, responseDueOn: "2026-11-04" }, "2026-11-04")).toBe("hot");
    expect(pollTier({ ...base, lastEntryOn: "2026-08-01" }, "2026-11-04")).toBe("routine");
    expect(pollTier({ ...base, kind: "extension" }, "2026-11-04")).toBe("routine");
    expect(pollTier({ ...base, status: "denied", rulingOn: "2026-11-02" }, "2026-11-04")).toBe("closed");
    expect(pollTier({ ...base, status: "denied", rulingOn: "2026-09-01" }, "2026-11-04")).toBe("retired");
  });

  it("has a fixed feed catalog that always excludes extensions", () => {
    expect(emergencyFeedBySlug("all")?.label).toMatch(/serious/i);
    expect(emergencyFeedBySlug("justice:elena-kagan")).not.toBeNull();
    expect(emergencyFeedBySlug("'; DROP TABLE x; --")).toBeNull();
    expect(EMERGENCY_FEEDS.length).toBeGreaterThan(10);
    expect(emergencyFeedConditionSql("a")).toContain("a.kind <> 'extension'");
  });

  it("never promises instant alerts", () => {
    expect(EMERGENCY_TIMING_NOTE).not.toMatch(/instant/i);
    expect(EMERGENCY_TIMING_NOTE).toMatch(/10 to 20 minutes/);
  });
});

describe("docket text cleanup", () => {
  it("drops document link labels but still withholds a line whose link title mentions a seal", () => {
    const page = parseApplicationPage(fixture("26a624"), "26A624");
    expect(page.lines[0]?.description).toBe("Application (26A624) for injunction pending appeal, submitted to Justice Kagan.");
    const sealedLink = fixture("26a624").replace("Main Document</a>", "Sealed Appendix</a>");
    const withheld = parseApplicationPage(sealedLink, "26A624");
    expect(withheld.withheldLines).toBe(1);
  });
});
