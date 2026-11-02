import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const read = (p: string) => readFileSync(path.join(root, p));

interface Roster { justices: { scdbJusticeId: number; scdbCode: string; fjcNid: string; appointments: { appointmentTitle: string | null; appointingPresident: string | null }[] }[] }

describe("Supreme Court justice analytics data", () => {
  it("has one roster entry per SCDB justice id, each with FJC appointment facts", () => {
    const roster = JSON.parse(read("data/scotus/justices.json").toString()) as Roster;
    expect(roster.justices.map((j) => j.scdbJusticeId)).toEqual(Array.from({ length: 118 }, (_, i) => i + 1));
    expect(new Set(roster.justices.map((j) => j.scdbCode)).size).toBe(118);
    expect(roster.justices.every((j) => j.fjcNid && j.appointments.length > 0 && j.appointments.every((a) => a.appointingPresident))).toBe(true);
    expect(roster.justices.reduce((n, j) => n + j.appointments.length, 0)).toBe(121);
    const byCode = Object.fromEntries(roster.justices.map((j) => [j.scdbCode, j]));
    expect(byCode.WHRehnquist!.appointments.map((a) => a.appointmentTitle)).toEqual(["Associate Justice", "Chief Justice"]);
    expect(byCode.JHarlan1!.fjcNid).not.toBe(byCode.JHarlan2!.fjcNid);
  });

  it("commits exactly the source files the README lists, with matching checksums", () => {
    const readme = read("data/README.md").toString();
    for (const file of [
      "scdb/2026_01/SCDB_2026_01_justiceCentered_Citation.csv.zip",
      "scdb/2026_01/SCDB_2026_01_caseCentered_Docket.csv.zip",
      "scdb/legacy_07/SCDB_Legacy_07_justiceCentered_Citation.csv.zip",
      "martin-quinn/2024/justices.csv",
    ]) {
      const hash = createHash("sha256").update(read(`data/${file}`)).digest("hex");
      expect(readme).toContain(`\`${file}\``);
      expect(readme).toContain(hash);
    }
  });

  it("never labels ideology by political party", () => {
    const files = [
      "db/migrations/0186_scotus_justice_analytics.sql",
      "scripts/import-scdb.ts",
      "data/scotus/justices.json",
      ...readdirSync(path.join(root, "src/modules/scotus"), { recursive: true }).map(String)
        .filter((f) => /\.tsx?$/.test(f)).map((f) => `src/modules/scotus/${f}`),
      ...readdirSync(path.join(root, "src/app/justices"), { recursive: true }).map(String)
        .filter((f) => f.endsWith(".tsx")).map((f) => `src/app/justices/${f}`),
    ];
    for (const file of files) {
      if (!statSync(path.join(root, file)).isFile()) continue;
      // Explanations may say direction is "not ... party"; they must never name one.
      expect(read(file).toString(), file).not.toMatch(/republican|democrat/i);
    }
  });

  it("keeps the production match-rate report read-only for diagnose-sql-once", () => {
    for (const file of ["scripts/diag/scdb-jurvio-match-rate.sql", "scripts/diag/scotus-justice-recon.sql"]) {
      expect(existsSync(path.join(root, file))).toBe(true);
      const body = read(file).toString().replace(/--.*$/gm, "");
      expect(body).not.toMatch(/transaction_read_only|transaction_isolation|read\s+write|\b(insert|update|delete|truncate|alter|drop|create|grant|revoke|vacuum|copy|call|do)\b\s/i);
    }
  });
});
