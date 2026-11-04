/**
 * Reads stored Supreme Court docket lines (JSON lines from a read-only query),
 * writes the entry_type/importance changes as TSV (id, entry_type, importance)
 * for the dispatch-only workflow to apply, and prints a JSON summary.
 *
 *   pnpm exec tsx scripts/reclassify-scotus-docket-entries.ts --input rows.jsonl --out changes.tsv
 */
import { readFileSync, writeFileSync } from "node:fs";
import { planScotusReclassification, type StoredScotusEntry } from "@/modules/ingestion/application/reclassify-scotus-entries";

function arg(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

const rows: StoredScotusEntry[] = readFileSync(arg("input"), "utf8").split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as StoredScotusEntry);
const plan = planScotusReclassification(rows);
const uuid = /^[0-9a-f-]{36}$/i;
const safe = /^[a-z_]+$/;
writeFileSync(arg("out"), plan.changes.map((change) => {
  if (!uuid.test(change.id) || !safe.test(change.toType) || !safe.test(change.toImportance)) throw new Error(`unexpected value for ${change.id}`);
  return `${change.id}\t${change.toType}\t${change.toImportance}\n`;
}).join(""));
process.stdout.write(`${JSON.stringify({ scanned: plan.scanned, changes: plan.changes.length, cases: plan.cases, skippedRestricted: plan.skippedRestricted, byTransition: plan.byTransition })}\n`);
