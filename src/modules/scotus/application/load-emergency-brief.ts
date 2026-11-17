/**
 * The stored AI description for one emergency application. Missing until the
 * brief job has written it. A missing table (migration not applied yet) returns
 * null so the public page keeps working.
 */
import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

export interface EmergencyBrief {
  body: string;
  model: string;
  promptVersion: string;
  generatedAt: string;
  aiGenerated: boolean;
}

export interface EmergencyTeaser {
  body: string;
  model: string;
  generatedAt: string;
}

export async function loadEmergencyBrief(sql: Sql, docketNumber: string): Promise<EmergencyBrief | null> {
  try {
    const rows = await sql<{ body: string; model: string; promptVersion: string; generatedAt: Date; aiGenerated: boolean }[]>`
      SELECT body, model, prompt_version AS "promptVersion", generated_at AS "generatedAt", ai_generated AS "aiGenerated"
      FROM scotus_application_brief
      WHERE docket_number = ${docketNumber}
    `;
    const row = rows[0];
    if (!row) return null;
    return { body: row.body, model: row.model, promptVersion: row.promptVersion, generatedAt: row.generatedAt.toISOString(), aiGenerated: row.aiGenerated };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "42P01" || code === "42703") return null;
    throw error;
  }
}

/** Stored follower-email preview. preview_only is enforced by the table. */
export async function loadEmergencyTeaser(sql: Sql, docketNumber: string): Promise<EmergencyTeaser | null> {
  try {
    const rows = await sql<{ body: string; model: string; generatedAt: Date }[]>`
      SELECT body, model, generated_at AS "generatedAt"
      FROM scotus_application_teaser
      WHERE docket_number = ${docketNumber} AND preview_only
    `;
    const row = rows[0];
    if (!row) return null;
    return { body: row.body, model: row.model, generatedAt: row.generatedAt.toISOString() };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "42P01" || code === "42703") return null;
    throw error;
  }
}
