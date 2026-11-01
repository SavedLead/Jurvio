const OBJECT_TYPES = new Set([
  "legal_case",
  "document",
  "entity",
  "court",
  "judge",
  "docket_entry",
]);

const OBJECT_ID = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/;

export type PublicationFlag = "displayable" | "indexable" | "machine_accessible" | "displayable_and_indexable";

/**
 * Latest publication flag for an object.
 *
 * `publication_current` is one primary-key lookup (migration 0124 maintains it
 * for cases and documents). `displayable` is stored on that row. Other flags
 * are read from the decision the mirror points at. A missing mirror row falls
 * back to the latest `publication_decision`, so a schema that only writes
 * decisions — including the citation integration fixture — keeps the same answer.
 * COALESCE stops after the first non-null value.
 */
export function latestPublicationColumnSql(
  column: PublicationFlag,
  objectType: string,
  objectIdExpr: string,
  /** Answer when the object has no decision at all (default false: hidden). */
  whenUndecided = false,
): string {
  if (!OBJECT_TYPES.has(objectType)) throw new Error(`unsupported publication object type: ${objectType}`);
  if (!OBJECT_ID.test(objectIdExpr)) throw new Error(`unsupported publication id expression: ${objectIdExpr}`);
  const selected = column === "displayable_and_indexable" ? "decision.displayable AND decision.indexable" : `decision.${column}`;
  const fallback = `(SELECT ${selected} FROM publication_decision decision
    WHERE decision.object_type = '${objectType}' AND decision.object_id = ${objectIdExpr}
    ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1)`;
  const mirrored = column === "displayable"
    ? `(SELECT current_row.displayable FROM publication_current current_row
        WHERE current_row.object_type = '${objectType}' AND current_row.object_id = ${objectIdExpr})`
    : `(SELECT ${selected} FROM publication_current current_row
        JOIN publication_decision decision ON decision.id = current_row.decision_id
        WHERE current_row.object_type = '${objectType}' AND current_row.object_id = ${objectIdExpr})`;
  return `COALESCE(${mirrored}, ${fallback}, ${whenUndecided ? "true" : "false"})`;
}
