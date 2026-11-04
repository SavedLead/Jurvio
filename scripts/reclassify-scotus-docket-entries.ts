/**
 * Reads stored Supreme Court docket lines (JSON lines from a read-only query),
 * writes a psql script that loads and applies the entry_type/importance
 * changes in one transaction (the dispatch-only workflow pipes it to psql), and prints a JSON summary.
 *
 *   pnpm exec tsx scripts/reclassify-scotus-docket-entries.ts --input rows.jsonl --out apply.sql
 */
import { readFileSync, writeFileSync } from "node:fs";
import { planScotusReclassification, reclassifyApplyScript, type StoredScotusEntry } from "@/modules/ingestion/application/reclassify-scotus-entries";

function arg(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

const rows: StoredScotusEntry[] = readFileSync(arg("input"), "utf8").split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as StoredScotusEntry);
const plan = planScotusReclassification(rows);
writeFileSync(arg("out"), reclassifyApplyScript(plan.changes));
process.stdout.write(`${JSON.stringify({ scanned: plan.scanned, changes: plan.changes.length, cases: plan.cases, skippedRestricted: plan.skippedRestricted, byTransition: plan.byTransition })}\n`);
