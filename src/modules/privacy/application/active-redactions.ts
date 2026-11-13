import type postgres from "postgres";
import { redactNames, type NameRedactionRule } from "../domain/redact-names";

type Sql = ReturnType<typeof postgres>;

let cached: { at: number; rules: NameRedactionRule[] } | null = null;
const TTL_MS = 30_000;

async function loadActiveRules(sql: Sql): Promise<NameRedactionRule[]> {
  const rows = await sql<{ fullName: string; initials: string }[]>`
    SELECT full_name AS "fullName", initials
    FROM name_redactions
    WHERE active
    ORDER BY length(full_name) DESC
  `;
  return rows;
}

export async function activeNameRedactions(sql: Sql): Promise<NameRedactionRule[]> {
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) return cached.rules;
  // A missing table inside a transaction aborts that transaction. A savepoint
  // keeps the caller's transaction usable until the migration has run.
  const transactional = sql as Sql & { savepoint?: (fn: (tx: Sql) => Promise<NameRedactionRule[]>) => Promise<NameRedactionRule[]> };
  try {
    const rows = typeof transactional.savepoint === "function"
      ? await transactional.savepoint((tx) => loadActiveRules(tx))
      : await loadActiveRules(sql);
    cached = { at: now, rules: rows };
    return rows;
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "42P01") return [];
    throw error;
  }
}

export function clearRedactionCache(): void {
  cached = null;
}

export async function redactPublicText(sql: Sql, value: string | null | undefined): Promise<{ text: string | null; changed: boolean }> {
  if (value == null || value === "") return { text: value ?? null, changed: false };
  const rules = await activeNameRedactions(sql);
  if (rules.length === 0) return { text: value, changed: false };
  const result = redactNames(value, rules);
  return { text: result.text, changed: result.changed };
}

export async function redactPublicFields<T extends object>(sql: Sql, record: T, fields: readonly (keyof T)[]): Promise<{ record: T; changed: boolean }> {
  let changed = false;
  const next = { ...record };
  for (const field of fields) {
    const value = next[field];
    if (typeof value !== "string" || value === "") continue;
    const redacted = await redactPublicText(sql, value);
    if (redacted.changed && redacted.text != null) {
      next[field] = redacted.text as T[keyof T];
      changed = true;
    }
  }
  return { record: next, changed };
}

export async function redactRows<T extends object>(sql: Sql, rows: readonly T[], fields: readonly (keyof T)[]): Promise<T[]> {
  const next: T[] = [];
  for (const row of rows) {
    const redacted = await redactPublicFields(sql, row, fields);
    next.push(redacted.record);
  }
  return next;
}
