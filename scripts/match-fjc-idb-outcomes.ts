// Match FJC Integrated Database rows to the federal district cases we hold and
// write how each case ended (disposition, judgment-for, date terminated) as a
// COPY-ready TSV for fjc_idb_case_outcome. Runs on the builder: the case keys
// are exported from the database once, matching happens in memory here, and
// the workflow loads the result in one COPY (no per-row database probes).
//
//   tsx scripts/match-fjc-idb-outcomes.ts --file fjc-integrated-database-YYYY-MM-DD.csv.bz2 \
//     --snapshot-date YYYY-MM-DD --keys keys.tsv --out outcomes.tsv
//
// keys.tsv: case_id <TAB> court_code <TAB> docket_core <TAB> office|\N <TAB> filed_year|\N
// A row is used only when it addresses exactly one of our cases with the same
// district and docket core, a consistent office and filing year, and carries
// a termination date or disposition. A case matched by two IDB rows that
// disagree on the outcome is dropped (counted), never guessed.
import { readFileSync, writeFileSync } from "node:fs";
import { fjcIdbCaseKey, fjcIdbSourceUri, readFjcIdbRows } from "@/modules/ingestion/providers/courtlistener/bulk-fjc-idb";

function option(name: string): string {
  const prefixed = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefixed));
  if (inline) return inline.slice(prefixed.length);
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

const file = option("file");
const snapshotDate = option("snapshot-date");
if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) throw new Error("--snapshot-date must be YYYY-MM-DD");
const keysPath = option("keys");
const out = option("out");

interface OurCase { caseId: string; office: string | null; filedYear: number | null }
const ours = new Map<string, OurCase[]>();
for (const line of readFileSync(keysPath, "utf8").split("\n")) {
  const [caseId, court, core, office, year] = line.split("\t");
  if (!caseId || !court || !core) continue;
  const key = `${court.toLowerCase()}/${core}`;
  const entry = { caseId, office: office && office !== "\\N" ? String(Number(office)) : null, filedYear: year && year !== "\\N" ? Number(year) : null };
  const list = ours.get(key);
  if (list) list.push(entry); else ours.set(key, [entry]);
}

function code(value: unknown): number | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^-?\d+$/.test(text)) return null;
  const number = Number(text);
  return number < 0 ? null : number; // -8 = missing in the IDB
}

interface Outcome { rowId: string; terminated: string | null; disposition: number | null; judgment: number | null; nature: number | null; progress: number | null; plaintiff: string; defendant: string }
const found = new Map<string, Outcome>();
const conflicted = new Set<string>();
const stats = { rows: 0, keyed: 0, ourKey: 0, officeOrYearMismatch: 0, ambiguousCase: 0, noOutcome: 0, matched: 0, conflicts: 0, duplicateSame: 0 };
for await (const row of readFjcIdbRows(file)) {
  stats.rows += 1;
  const key = fjcIdbCaseKey(row);
  if (!key) continue;
  stats.keyed += 1;
  const candidates = ours.get(`${key.districtCode}/${key.docketCore}`);
  if (!candidates) continue;
  stats.ourKey += 1;
  const consistent = candidates.filter((candidate) =>
    (candidate.office === null || key.office === null || candidate.office === key.office)
    && (candidate.filedYear === null || candidate.filedYear === key.filingYear));
  if (consistent.length === 0) { stats.officeOrYearMismatch += 1; continue; }
  if (consistent.length > 1) { stats.ambiguousCase += 1; continue; }
  const record = row as Record<string, unknown>;
  const terminated = /^\d{4}-\d{2}-\d{2}/.test(row.date_terminated ?? "") ? (row.date_terminated ?? "").slice(0, 10) : null;
  const outcome: Outcome = {
    rowId: row.id, terminated,
    disposition: code(record.disposition), judgment: code(record.judgment),
    nature: code(record.nature_of_judgement ?? record.nature_of_judgment), progress: code(record.procedural_progress),
    plaintiff: (row.plaintiff ?? "").replace(/\s+/g, " ").trim(), defendant: (row.defendant ?? "").replace(/\s+/g, " ").trim(),
  };
  if (!outcome.terminated && outcome.disposition === null) { stats.noOutcome += 1; continue; }
  const caseId = consistent[0]!.caseId;
  const previous = found.get(caseId);
  if (previous) {
    const same = previous.disposition === outcome.disposition && previous.judgment === outcome.judgment && previous.terminated === outcome.terminated;
    if (same) { stats.duplicateSame += 1; continue; }
    // The IDB re-reports a case when it is reopened; a later termination supersedes an earlier one.
    if (previous.terminated && outcome.terminated && previous.terminated !== outcome.terminated) {
      if (outcome.terminated > previous.terminated) found.set(caseId, outcome);
      continue;
    }
    conflicted.add(caseId);
    continue;
  }
  found.set(caseId, outcome);
}
for (const caseId of conflicted) found.delete(caseId);
stats.conflicts = conflicted.size;

const cell = (value: string | number | null) => value === null || value === "" ? "\\N" : String(value).replaceAll("\\", "\\\\").replaceAll(/[\t\r\n]/g, " ");
const lines: string[] = [];
for (const [caseId, outcome] of found) {
  lines.push([caseId, snapshotDate, outcome.rowId, outcome.terminated, outcome.disposition, outcome.judgment, outcome.nature, outcome.progress,
    outcome.plaintiff, outcome.defendant, fjcIdbSourceUri(snapshotDate, outcome.rowId)].map(cell).join("\t"));
}
writeFileSync(out, lines.length ? `${lines.join("\n")}\n` : "");
stats.matched = found.size;
console.log(JSON.stringify(stats));
