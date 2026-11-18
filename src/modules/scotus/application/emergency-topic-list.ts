import type postgres from "postgres";
import { emergencyTopicBySlug, type EmergencyTopic } from "@/modules/scotus/domain/emergency-topics";

type Sql = ReturnType<typeof postgres>;

export interface EmergencyTopicRow {
  docketNumber: string;
  caption: string;
  status: string;
  kind: string;
}

export async function listEmergencyTopic(sql: Sql, slug: string): Promise<{ topic: EmergencyTopic; rows: EmergencyTopicRow[] } | null> {
  const topic = emergencyTopicBySlug(slug);
  if (!topic) return null;
  try {
    const rows = await sql<EmergencyTopicRow[]>`
      SELECT a.docket_number AS "docketNumber", a.caption, a.status, a.kind
      FROM scotus_application_detail d
      JOIN scotus_application a ON a.docket_number = d.docket_number
      WHERE ${topic.slug} = ANY(d.topics)
        AND a.kind <> 'extension'
      ORDER BY a.last_entry_on DESC NULLS LAST, a.docket_number DESC
      LIMIT 200
    `;
    return { topic, rows };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "42P01" || code === "42703") return { topic, rows: [] };
    throw error;
  }
}
