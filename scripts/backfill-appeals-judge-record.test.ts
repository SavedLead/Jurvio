import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

describe("district mode", () => {
  it("writes judge_line rows, the district matcher version, and no outcomes", () => {
    const dir = mkdtempSync(join(tmpdir(), "district-"));
    writeFileSync(join(dir, "roster.tsv"), "j-rakoff\tnysd\tjed saul rakoff\t1996-03-01\t\\N\tDemocratic\nj-mag\tnysd\tsarah netburn\t2012-01-01\t\\N\t\\N\n");
    writeFileSync(join(dir, "cases.tsv"), "00000000-0000-0000-0000-000000000001\tcourt-1\tnysd\t2020-05-01\tRakoff\tNetburn\tAFFIRMED\n");
    const out = spawnSync(process.execPath, ["--import", "tsx", "scripts/backfill-appeals-judge-record.ts", "seats", "--district",
      "--roster", join(dir, "roster.tsv"), "--cases", join(dir, "cases.tsv"), "--seats-out", join(dir, "seats.tsv"),
      "--outcomes-out", join(dir, "outcomes.tsv"), "--stats", join(dir, "stats.json")], { encoding: "utf8" });
    expect(out.status, out.stderr).toBe(0);
    const rows = readFileSync(join(dir, "seats.tsv"), "utf8").trim().split("\n").map((line) => line.split("\t"));
    expect(rows.map((row) => [row[4], row[6], row[7], row[9]])).toEqual([
      ["judge_line", "j-rakoff", "matched", "district-opinion-fjc-v1"],
      ["author", "j-mag", "matched", "district-opinion-fjc-v1"],
    ]);
    expect(readFileSync(join(dir, "outcomes.tsv"), "utf8").trim()).toBe("");
  }, 20_000);
});
