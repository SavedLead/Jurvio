import { describe, expect, it } from "vitest";
import { readKeyDatesAhead } from "./key-dates";

describe("key dates ahead", () => {
  it("reads future hearings, trials and deadlines with the docket's words", () => {
    const dates = readKeyDatesAhead([
      { entryNumber: 40, filedOn: "2026-10-01", description: "ORDER: Motion Hearing set for 12/3/2026 at 10:00 AM in Courtroom 4 before Judge Lee." },
      { entryNumber: 41, filedOn: "2026-10-02", description: "SCHEDULING ORDER: Jury Trial set for March 9, 2027. Responses due by 11/20/2026." },
      { entryNumber: 12, filedOn: "2026-01-02", description: "Status Conference set for 2/1/2026." },
    ], "2026-11-02");
    expect(dates.map((d) => [d.kind, d.date])).toEqual([["deadline", "2026-11-20"], ["hearing", "2026-12-03"], ["trial", "2027-03-09"]]);
    expect(dates[1]?.time).toBe("10:00 AM");
    expect(dates[1]?.quote).toContain("Motion Hearing set for 12/3/2026");
  });
  it("lets a reset replace the earlier date and a vacatur remove it", () => {
    const reset = readKeyDatesAhead([
      { filedOn: "2026-10-01", description: "Motion Hearing set for 12/3/2026." },
      { filedOn: "2026-10-15", description: "Motion Hearing reset for 1/14/2027." },
    ], "2026-11-02");
    expect(reset.map((d) => d.date)).toEqual(["2027-01-14"]);
    const vacated = readKeyDatesAhead([
      { filedOn: "2026-10-01", description: "Motion Hearing set for 12/3/2026." },
      { filedOn: "2026-10-15", description: "ORDER: the motion hearing is VACATED." },
    ], "2026-11-02");
    expect(vacated).toEqual([]);
  });
  it("reads deadlines and skips sealed entries and impossible dates", () => {
    const dates = readKeyDatesAhead([
      { filedOn: "2026-10-20", description: "Responses due by 11/20/2026." },
      { filedOn: "2026-10-20", description: "SEALED ORDER: hearing set for 12/1/2026." },
      { filedOn: "2026-10-20", description: "Hearing set for 2/30/2027." },
    ], "2026-11-02");
    expect(dates.map((d) => [d.kind, d.date])).toEqual([["deadline", "2026-11-20"]]);
  });
  it("drops dates set before the case closed", () => {
    expect(readKeyDatesAhead([{ filedOn: "2026-09-01", description: "Jury Trial set for 3/9/2027." }], "2026-11-02", 6, "2026-10-01")).toEqual([]);
  });
});
