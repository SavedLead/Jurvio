// Match the judges printed on court of appeals opinions to Federal Judicial
// Center (FJC) judges, and read each appeal's outcome by fixed word rules.
// Runs on the builder (never on a web host); the workflow exports small TSVs
// from production, runs this, and loads the results into appeals_panel_seat and
// appeals_case_outcome (migration 0192).
//
//   tsx scripts/backfill-appeals-judge-record.ts seats --roster roster.tsv --cases cases.tsv \
//     --seats-out seats.tsv --outcomes-out outcomes.tsv --stats stats.json
//   tsx scripts/backfill-appeals-judge-record.ts seats --district ... (district court opinions: role judge_line,
//     no reporter outcomes; roster includes FJC magistrate judges; loads into district_opinion_judge, 0193)
//   tsx scripts/backfill-appeals-judge-record.ts closings --tails tails.tsv --outcomes-out outcomes.tsv --stats stats.json
//
// roster.tsv: judge_id, court_key, normalized_name, started_on, ended_on, appointing_president_party
//   (FJC service terms on courts of appeals, active and senior; court_key is the
//   lower-cased provider court id such as ca7, because a circuit can have more
//   than one court row).
// cases.tsv: case_id, court_id, court_key, decided_on, judges_line, author_name, reporter_disposition
// tails.tsv: case_id, last ~1,600 characters of the main opinion before any separate opinion
//
// A name is linked only when exactly one FJC judge with that surname served on
// that court on the decision date. Everything else is kept as ambiguous or
// unmatched so the page can show honest match rates. No AI, no network.
import { readFileSync, writeFileSync } from "node:fs";
import { appealsOutcomeOf, observedKeys, parsePanelSurnames, rosterKeys } from "@/modules/judges/domain/lower-court-analytics";
import { readDispositionLine, readOpinionClosing } from "@/modules/plain-english/domain/case-standing";

export const MATCHER_VERSION = "appeals-panel-fjc-v1";
export const OUTCOME_RULE_VERSION = "appeals-outcome-v1";
export const DISTRICT_MATCHER_VERSION = "district-opinion-fjc-v1";

const args = process.argv.slice(2);
const mode = args[0];
const option = (name: string) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : undefined; };

/** Decode one field of PostgreSQL COPY text format. */
export function copyField(raw: string): string | null {
  if (raw === "\\N") return null;
  return raw.replace(/\\(.)/g, (_, char: string) => (char === "t" ? "\t" : char === "n" ? "\n" : char === "r" ? "\r" : char));
}

function readTsv(path: string, width: number): Array<Array<string | null>> {
  return readFileSync(path, "utf8").split("\n").filter(Boolean)
    .map((line) => { const fields = line.split("\t").map(copyField); return Array.from({ length: width }, (_, i) => fields[i] ?? null); });
}

function copyValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "\\N";
  return String(value).replaceAll("\\", "\\\\").replaceAll("\t", " ").replaceAll("\n", " ").replaceAll("\r", " ");
}

/** courtId holds the court key (provider court id), not a uuid. */
export interface RosterRow { judgeId: string; courtId: string; keys: string[]; startedOn: string | null; endedOn: string | null; party: string | null }

export function buildRosterIndex(rows: RosterRow[]): Map<string, RosterRow[]> {
  const index = new Map<string, RosterRow[]>();
  for (const row of rows) for (const key of row.keys) {
    const bucket = `${row.courtId}|${key}`;
    index.set(bucket, [...(index.get(bucket) ?? []), row]);
  }
  return index;
}

export function matchName(index: Map<string, RosterRow[]>, courtId: string, surname: string, day: string | null):
  { status: "matched" | "ambiguous" | "unmatched"; judgeId: string | null; party: string | null } {
  const judges = new Map<string, string | null>();
  for (const key of observedKeys(surname)) {
    for (const row of index.get(`${courtId}|${key}`) ?? []) {
      if (day && row.startedOn && row.startedOn > day) continue;
      if (day && row.endedOn && row.endedOn < day) continue;
      if (!judges.has(row.judgeId) || row.party) judges.set(row.judgeId, row.party);
    }
  }
  if (judges.size === 1) { const [[judgeId, party]] = [...judges.entries()] as [[string, string | null]]; return { status: "matched", judgeId, party }; }
  return { status: judges.size ? "ambiguous" : "unmatched", judgeId: null, party: null };
}

function runSeats() {
  const district = args.includes("--district");
  const panelRole = district ? "judge_line" : "panel";
  const matcherVersion = district ? DISTRICT_MATCHER_VERSION : MATCHER_VERSION;
  const roster = readTsv(option("roster")!, 6).map(([judgeId, courtKey, name, startedOn, endedOn, party]) => ({
    judgeId: judgeId!, courtId: courtKey!, keys: rosterKeys(name ?? ""), startedOn: startedOn ?? null, endedOn: endedOn ?? null, party: party ?? null,
  }));
  const index = buildRosterIndex(roster);
  const seatsOut: string[] = [];
  const outcomesOut: string[] = [];
  const stats = { cases: 0, casesWithPanel: 0, panelSlots: 0, panelMatched: 0, panelAmbiguous: 0, authorNamed: 0, authorMatched: 0, authorAmbiguous: 0, reporterOutcomes: 0, rosterRows: roster.length };
  for (const [caseId, courtId, courtKey, decidedOn, judgesLine, authorName, disposition] of readTsv(option("cases")!, 7)) {
    if (!caseId || !courtId || !courtKey) continue;
    stats.cases += 1;
    const names = parsePanelSurnames(judgesLine);
    if (names.length) stats.casesWithPanel += 1;
    names.slice(0, 40).forEach((name, seat) => {
      const match = matchName(index, courtKey, name, decidedOn ?? null);
      stats.panelSlots += 1;
      if (match.status === "matched") stats.panelMatched += 1;
      if (match.status === "ambiguous") stats.panelAmbiguous += 1;
      seatsOut.push([caseId, courtId, decidedOn, seat, panelRole, name, match.judgeId, match.status, match.party, matcherVersion].map(copyValue).join("\t"));
    });
    const author = parsePanelSurnames(authorName)[0];
    if (author) {
      stats.authorNamed += 1;
      const match = matchName(index, courtKey, author, decidedOn ?? null);
      if (match.status === "matched") stats.authorMatched += 1;
      if (match.status === "ambiguous") stats.authorAmbiguous += 1;
      seatsOut.push([caseId, courtId, decidedOn, 0, "author", author, match.judgeId, match.status, match.party, matcherVersion].map(copyValue).join("\t"));
    }
    if (district) continue;
    const reading = readDispositionLine(disposition, "case-data");
    const outcome = reading ? appealsOutcomeOf(reading.kind) : null;
    if (reading && outcome) {
      stats.reporterOutcomes += 1;
      outcomesOut.push([caseId, outcome, "reporter_disposition", reading.quote.slice(0, 600), OUTCOME_RULE_VERSION].map(copyValue).join("\t"));
    }
  }
  writeFileSync(option("seats-out")!, seatsOut.length ? `${seatsOut.join("\n")}\n` : "");
  writeFileSync(option("outcomes-out")!, outcomesOut.length ? `${outcomesOut.join("\n")}\n` : "");
  writeFileSync(option("stats")!, JSON.stringify(stats));
  process.stdout.write(`${JSON.stringify(stats)}\n`);
}

function runClosings() {
  const out: string[] = [];
  const stats = { tails: 0, outcomes: 0, byOutcome: {} as Record<string, number> };
  for (const [caseId, tail] of readTsv(option("tails")!, 2)) {
    if (!caseId) continue;
    stats.tails += 1;
    const reading = readOpinionClosing(tail);
    const outcome = reading ? appealsOutcomeOf(reading.kind) : null;
    if (!reading || !outcome) continue;
    stats.outcomes += 1;
    stats.byOutcome[outcome] = (stats.byOutcome[outcome] ?? 0) + 1;
    out.push([caseId, outcome, "opinion_closing", reading.quote.slice(0, 600), OUTCOME_RULE_VERSION].map(copyValue).join("\t"));
  }
  writeFileSync(option("outcomes-out")!, out.length ? `${out.join("\n")}\n` : "");
  writeFileSync(option("stats")!, JSON.stringify(stats));
  process.stdout.write(`${JSON.stringify(stats)}\n`);
}

if (mode === "seats") runSeats();
else if (mode === "closings") runClosings();
else if (mode !== undefined && !process.env.VITEST) { process.stderr.write("usage: seats|closings ...\n"); process.exit(2); }
