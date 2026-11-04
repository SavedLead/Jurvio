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
