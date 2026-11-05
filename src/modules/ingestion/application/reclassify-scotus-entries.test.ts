import { describe, expect, it } from "vitest";
import { entryImportance } from "@/modules/ingestion/providers/scotus/official-docket";
import { planScotusReclassification, type StoredScotusEntry } from "./reclassify-scotus-entries";

const row = (id: number, docketNumber: string, description: string, entryType: string, importance = "routine"): StoredScotusEntry => ({
  id: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`, caseId: `case-${docketNumber}`, docketNumber, entryType, importance, description,
});

describe("one-time SCOTUS docket line reclassification", () => {
  const rows = [
    row(1, "26A382", "Response to application from respondent Moshe Bain, et al. filed.", "docket_activity"),
    row(2, "26A382", "Order entered by Justice Sotomayor: Upon consideration of the application of counsel for the applicants and the response filed thereto, it is ordered that the application for stay is denied without prejudice.", "order"),
    row(3, "25A810", "The application to vacate the Ninth Circuit's stay presented to Justice Kagan and by her referred to the Court is granted as to the parents but is otherwise denied.", "decision", "high"),
    row(4, "17-961", "Application (18A242) to file a reply brief on the merits in excess of the word limit granted in part by The Chief Justice.", "brief_filed"),
    row(5, "24-20", "Application (24A795) granted in part by Justice Sotomayor. Application for leave to file a consolidated response brief on the merits.", "application_granted", "high"),
    row(6, "16-1436 (16A1190)", "Application (16A1190) and application (16A1191) are GRANTED IN PART. In addition, application (16A1191) is treated as a petition for a writ of certiorari.", "decision", "high"),
    row(7, "26A600", "Application (26A600) granted by Justice Kagan extending the time to file until December 1, 2026.", "application_granted", "high"),
    row(8, "24-100", "Brief of respondent filed.", "brief_filed"),
    row(9, "26A1", "Motion for leave to file under seal with redacted copies filed. Response to application from respondent Doe filed.", "docket_activity"),
  ];
  const plan = planScotusReclassification(rows);
  const byId = Object.fromEntries(plan.changes.map((change) => [change.id.slice(-1), change]));

  it("retypes the lines the old parser missed and marks real rulings important", () => {
    expect(byId["1"]).toMatchObject({ toType: "application_response_filed", toImportance: "routine" });
    expect(byId["2"]).toMatchObject({ toType: "application_denied", toImportance: "high" });
    expect(byId["3"]).toMatchObject({ toType: "application_granted_in_part", toImportance: "high" });
    expect(byId["6"]).toMatchObject({ toType: "application_granted_in_part", toImportance: "high" });
  });

  it("keeps procedural filing requests on merits dockets routine, but not emergency applications", () => {
    expect(byId["4"]).toMatchObject({ toType: "application_granted_in_part", toImportance: "routine" });
    expect(byId["5"]).toMatchObject({ toType: "application_granted_in_part", toImportance: "routine" });
    expect(byId["7"]).toBeUndefined(); // "A" docket: stays high
    expect(entryImportance("application_granted", "Application (26A600) granted by Justice Kagan extending the time to file.", "26A600")).toBe("high");
  });

  it("leaves other lines and anything the restricted filter matches untouched", () => {
    expect(byId["8"]).toBeUndefined();
    expect(byId["9"]).toBeUndefined();
    expect(plan.skippedRestricted).toBe(1);
    expect(plan).toMatchObject({ scanned: 9, cases: 5 });
  });

  it("is idempotent: applying the plan and planning again changes nothing", () => {
    const applied = rows.map((entry) => {
      const change = plan.changes.find((item) => item.id === entry.id);
      return change ? { ...entry, entryType: change.toType, importance: change.toImportance } : entry;
    });
    expect(planScotusReclassification(applied).changes).toEqual([]);
  });
});
