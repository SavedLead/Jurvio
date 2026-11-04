/**
 * One-time re-typing of stored Supreme Court docket lines with the current
 * classifier (et al.-safe application lines, rulings written as orders,
 * partial grants) and importance rules (routine filing requests on merits
 * dockets stay routine). Pure: the dispatch-only workflow reads rows, this
 * decides the changes, and the workflow applies only entry_type/importance.
 *
 * It never changes created_at (alerts and digests key on it), descriptions,
 * publication decisions or anything sealed/restricted: lines that the strict
 * restricted-text filter matches are skipped untouched.
 */
import { isRestrictedDocketText } from "@/modules/ingestion/domain/federal-stream";
import { classifyEvent, entryImportance } from "@/modules/ingestion/providers/scotus/official-docket";

export interface StoredScotusEntry {
  id: string;
  caseId: string;
  docketNumber: string | null;
  entryType: string;
  importance: string;
  description: string;
}

export interface EntryChange { id: string; caseId: string; fromType: string; toType: string; fromImportance: string; toImportance: string }

export interface ReclassifyPlan {
  changes: EntryChange[];
  scanned: number;
  skippedRestricted: number;
  cases: number;
  byTransition: Record<string, number>;
}

/** The types this fix introduced or corrected; other lines keep whatever an older classifier stored. */
const TARGET_TYPES: ReadonlySet<string> = new Set([
  "application_response_filed", "application_granted", "application_granted_in_part", "application_denied",
]);

export function planScotusReclassification(rows: Iterable<StoredScotusEntry>): ReclassifyPlan {
  const changes: EntryChange[] = [];
  const cases = new Set<string>();
  const byTransition: Record<string, number> = {};
  let scanned = 0;
  let skippedRestricted = 0;
  for (const row of rows) {
    scanned += 1;
    if (isRestrictedDocketText(row.description)) { skippedRestricted += 1; continue; }
    const toType = classifyEvent(row.description);
    const toImportance = entryImportance(toType, row.description, row.docketNumber);
    if (!TARGET_TYPES.has(toType)) continue;
    if (toType === row.entryType && toImportance === row.importance) continue;
    changes.push({ id: row.id, caseId: row.caseId, fromType: row.entryType, toType, fromImportance: row.importance, toImportance });
    cases.add(row.caseId);
    const key = `${row.entryType}/${row.importance} -> ${toType}/${toImportance}`;
    byTransition[key] = (byTransition[key] ?? 0) + 1;
  }
  return { changes, scanned, skippedRestricted, cases: cases.size, byTransition };
}

/**
 * The write, run inside one transaction after the changes are loaded into a
 * temp table `incoming (id uuid, entry_type text, importance text)`. created_at
 * and updated_at are left alone, so no digest or alert watermark sees these
 * lines as new. A second run updates nothing.
 */
export const RECLASSIFY_UPDATE_SQL = `WITH changed AS (
  UPDATE docket_entry e SET entry_type = i.entry_type, importance = i.importance
  FROM incoming i
  WHERE e.id = i.id AND (e.entry_type IS DISTINCT FROM i.entry_type OR e.importance IS DISTINCT FROM i.importance)
  RETURNING e.case_id
)
SELECT 'updated lines' AS label, count(*)::int AS lines, count(DISTINCT case_id)::int AS cases FROM changed`;

/** psql script for the workflow: load the changes, apply them, commit. */
export function reclassifyApplyScript(changes: readonly EntryChange[]): string {
  const rows = changes.map((change) => {
    if (!/^[0-9a-f-]{36}$/i.test(change.id) || !/^[a-z_]+$/.test(change.toType) || !/^[a-z_]+$/.test(change.toImportance)) {
      throw new Error(`unexpected value for ${change.id}`);
    }
    return `${change.id}\t${change.toType}\t${change.toImportance}\n`;
  }).join("");
  return [
    "\\set ON_ERROR_STOP on",
    "BEGIN;",
    "SET LOCAL statement_timeout = '300s';",
    "SET LOCAL lock_timeout = '10s';",
    "CREATE TEMP TABLE incoming (id uuid PRIMARY KEY, entry_type text NOT NULL, importance text NOT NULL) ON COMMIT DROP;",
    "COPY incoming (id, entry_type, importance) FROM STDIN;",
    `${rows}\\.`,
    `${RECLASSIFY_UPDATE_SQL};`,
    "COMMIT;",
    "",
  ].join("\n");
}
