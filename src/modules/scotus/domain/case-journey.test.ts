import { describe, expect, it } from "vitest";
import { buildCaseJourney, daysBetween, gapLabel, isEmergencyApplication, type JourneyInput } from "./case-journey";

const base: JourneyInput = {
  docketNumber: "23-719", officialDocketUrl: "https://www.supremecourt.gov/x", lowerCourt: "Supreme Court of Colorado",
  lowerCourtDecidedOn: "2023-12-19", lowerCaseNumbers: ["23SA300"], linkedLowerCase: null, docketedOn: "2024-01-03",
  certStatus: "granted", certStatusOn: "2024-01-05", certEntry: "Petition GRANTED.", judgmentOn: "2024-03-04",
  judgmentEntry: "Judgment REVERSED.", entries: [{ filedOn: "2024-02-08", description: "Argued. For petitioner: Jonathan F. Mitchell." }],
};

describe("case journey", () => {
  it("orders the official steps and adds argument from the docket", () => {
    expect(buildCaseJourney(base).map((step) => step.key)).toEqual(["lower-decided", "docketed", "cert", "argued", "judgment"]);
  });
  it("leaves out steps the records do not show", () => {
    const steps = buildCaseJourney({ ...base, lowerCourtDecidedOn: null, certStatus: "pending", certStatusOn: null, judgmentOn: null, entries: [] });
    expect(steps.map((step) => step.key)).toEqual(["docketed"]);
  });
  it("treats A dockets as emergency applications", () => {
    expect(isEmergencyApplication("24A884")).toBe(true);
    expect(isEmergencyApplication("24-884")).toBe(false);
    const steps = buildCaseJourney({ ...base, docketNumber: "24A884", certStatus: "pending", certStatusOn: null, judgmentOn: null,
      entries: [{ filedOn: "2025-03-10", description: "Application (24A884) denied by Justice Kavanaugh." }] });
    expect(steps.map((step) => step.title)).toContain("Application denied");
    expect(steps.find((step) => step.key === "docketed")?.title).toBe("Emergency application filed");
  });
  it("words gaps plainly", () => {
    expect(daysBetween("2024-01-03", "2024-03-04")).toBe(61);
    expect(gapLabel(61)).toBe("about 2 months later");
    expect(daysBetween("2024-03-04", "2024-01-03")).toBeNull();
  });
});
