/**
 * Reads stored Supreme Court docket lines (JSON lines from a read-only query),
 * writes a psql script that loads and applies the entry_type/importance
 * changes in one transaction (the dispatch-only workflow pipes it to psql),
 * writes a spot-check sample JSON, and prints a JSON summary.
 *
 *   pnpm exec tsx scripts/reclassify-scotus-docket-entries.ts --input rows.jsonl --out apply.sql [--samples samples.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  isGeneralToGrantedRoutine,
  isRoutineToHigh,
  planScotusReclassification,
  reclassifyApplyScript,
  sampleChanges,
  type EntryChange,
  type StoredScotusEntry,
} from "@/modules/ingestion/application/reclassify-scotus-entries";

const isHighToRoutine = (c: EntryChange) => c.fromImportance === "high" && c.toImportance === "routine";

function arg(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function optionalArg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const rows: StoredScotusEntry[] = readFileSync(arg("input"), "utf8")
  .split("\n")
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line) as StoredScotusEntry);
const plan = planScotusReclassification(rows);
writeFileSync(arg("out"), reclassifyApplyScript(plan.changes));
const samples = {
  routineToHigh: sampleChanges(plan.changes, 25, isRoutineToHigh),
  generalToGrantedRoutine: sampleChanges(plan.changes, 15, isGeneralToGrantedRoutine),
  highToRoutine: sampleChanges(plan.changes, 10, isHighToRoutine),
  routineToHighCount: plan.changes.filter(isRoutineToHigh).length,
  generalToGrantedRoutineCount: plan.changes.filter(isGeneralToGrantedRoutine).length,
  highToRoutineCount: plan.changes.filter(isHighToRoutine).length,
};
const samplesPath = optionalArg("samples");
if (samplesPath) writeFileSync(samplesPath, `${JSON.stringify(samples, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  scanned: plan.scanned,
  changes: plan.changes.length,
  cases: plan.cases,
  skippedRestricted: plan.skippedRestricted,
  byTransition: plan.byTransition,
  routineToHighCount: samples.routineToHighCount,
  generalToGrantedRoutineCount: samples.generalToGrantedRoutineCount,
  highToRoutineCount: samples.highToRoutineCount,
})}\n`);
