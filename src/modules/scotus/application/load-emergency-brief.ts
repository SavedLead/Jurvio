/**
 * The stored summary for one emergency application. Missing until the
 * brief job has written it. A missing table (migration not applied yet) returns
 * null so the public page keeps working.
 */
import type postgres from "postgres";
import { emergencyTopicBySlug } from "@/modules/scotus/domain/emergency-topics";

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

function mapBrief(row: { body: string; model: string; promptVersion: string; generatedAt: Date; aiGenerated: boolean } | undefined): EmergencyBrief | null {
  if (!row) return null;
  return { body: row.body, model: row.model, promptVersion: row.promptVersion, generatedAt: row.generatedAt.toISOString(), aiGenerated: row.aiGenerated };
}

export async function loadEmergencyBrief(sql: Sql, docketNumber: string): Promise<EmergencyBrief | null> {
  const versions = await loadEmergencyBriefVersions(sql, docketNumber);
  return versions[0] ?? null;
}

/** The stored description, then any other model's text kept for the same docket. */
export async function loadEmergencyBriefVersions(sql: Sql, docketNumber: string): Promise<EmergencyBrief[]> {
  try {
    const primary = await sql<{ body: string; model: string; promptVersion: string; generatedAt: Date; aiGenerated: boolean }[]>`
      SELECT body, model, prompt_version AS "promptVersion", generated_at AS "generatedAt", ai_generated AS "aiGenerated"
      FROM scotus_application_brief
      WHERE docket_number = ${docketNumber}
    `;
    let alts: { body: string; model: string; promptVersion: string; generatedAt: Date; aiGenerated: boolean }[] = [];
    try {
      alts = await sql<{ body: string; model: string; promptVersion: string; generatedAt: Date; aiGenerated: boolean }[]>`
        SELECT body, model, prompt_version AS "promptVersion", generated_at AS "generatedAt", ai_generated AS "aiGenerated"
        FROM scotus_application_brief_alt
        WHERE docket_number = ${docketNumber}
        ORDER BY model
      `;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "42P01" && code !== "42703") throw error;
    }
    return [mapBrief(primary[0]), ...alts.map((row) => mapBrief(row))].filter((row): row is EmergencyBrief => row !== null);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "42P01" || code === "42703") return [];
    throw error;
  }
}

const PUBLIC_SUMMARY_MODEL = "gpt-6.1-sol";

export interface PublicCaseDetail {
  topics: { slug: string; label: string }[];
  stake: string | null;
  orderExplainer: string | null;
  applicantPoints: string[];
  respondentPoints: string[];
  related: { docket: string }[];
}

/** Topics, stake, order, arguments, and related dockets. Missing until the job has stored them. */
export async function loadPublicCaseDetail(sql: Sql, docketNumber: string): Promise<PublicCaseDetail | null> {
  try {
    const rows = await sql<{
      topics: string[];
      stake: string | null;
      orderExplainer: string | null;
      applicantPoints: string[];
      respondentPoints: string[];
      related: string[];
    }[]>`
      SELECT topics, stake, order_explainer AS "orderExplainer",
        applicant_points AS "applicantPoints", respondent_points AS "respondentPoints",
        related_dockets AS related
      FROM scotus_application_detail
      WHERE docket_number = ${docketNumber}
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      topics: row.topics.map((slug) => emergencyTopicBySlug(slug)).filter((topic) => topic !== null).map((topic) => ({ slug: topic.slug, label: topic.label })),
      stake: row.stake,
      orderExplainer: row.orderExplainer,
      applicantPoints: row.applicantPoints,
      respondentPoints: row.respondentPoints,
      related: row.related.filter((docket) => /^[0-9]{2}A[0-9]{1,4}$/.test(docket)).map((docket) => ({ docket })),
    };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "42P01" || code === "42703") return null;
    throw error;
  }
}

/** One summary for the public page. Any other stored version stays unread here. */
export async function loadPublicEmergencySummary(sql: Sql, docketNumber: string): Promise<{ body: string } | null> {
  const versions = await loadEmergencyBriefVersions(sql, docketNumber);
  const chosen = versions.find((version) => version.model === PUBLIC_SUMMARY_MODEL) ?? versions[0];
  if (!chosen?.body) return null;
  return { body: chosen.body };
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
