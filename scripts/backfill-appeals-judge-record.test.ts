import { describe, expect, it } from "vitest";
import { rosterKeys } from "@/modules/judges/domain/lower-court-analytics";
import { buildRosterIndex, copyField, matchName } from "./backfill-appeals-judge-record";

const roster = buildRosterIndex([
  { judgeId: "dwood", courtId: "ca7", keys: rosterKeys("diane pamela wood"), startedOn: "1995-06-30", endedOn: "2024-04-30", party: "Democratic" },
  { judgeId: "hwood", courtId: "ca7", keys: rosterKeys("harlington wood jr"), startedOn: "1976-05-07", endedOn: "2008-12-29", party: "Republican" },
  { judgeId: "ja", courtId: "ca7", keys: rosterKeys("candace rae jackson akiwumi"), startedOn: "2021-07-01", endedOn: null, party: "Democratic" },
]);

describe("appeals matcher", () => {
  it("matches only one judge serving that day", () => {
    expect(matchName(roster, "ca7", "wood", "2000-01-01").status).toBe("ambiguous");
    expect(matchName(roster, "ca7", "wood", "2022-01-01")).toEqual({ status: "matched", judgeId: "dwood", party: "Democratic" });
    expect(matchName(roster, "ca7", "wood", "1980-01-01").judgeId).toBe("hwood");
    expect(matchName(roster, "ca5", "wood", "2022-01-01").status).toBe("unmatched");
    expect(matchName(roster, "ca7", "jackson-akiwumi", "2023-01-01").judgeId).toBe("ja");
  });
  it("decodes COPY text fields", () => {
    expect(copyField("\\N")).toBeNull();
    expect(copyField("a\\tb\\nc\\\\d")).toBe("a\tb\nc\\d");
  });
});
