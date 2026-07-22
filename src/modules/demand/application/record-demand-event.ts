import { createHash } from "node:crypto";
import type postgres from "postgres";
import { classifyVisitor } from "../domain/classify-visitor";

type Sql = ReturnType<typeof postgres>;
type EventType = "page_view" | "internal_search" | "document_view";
type TargetType = "case" | "document";

interface DemandEventInput {
  eventType: EventType;
  userAgent: string | null;
  referrer: string | null;
  path: string;
  targetType?: TargetType;
  targetPublicId?: string;
  rawSearchQuery?: string;
}

function referrerHost(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.slice(0, 255);
  } catch {
    return null;
  }
}

export async function recordDemandEvent(sql: Sql, input: DemandEventInput): Promise<void> {
  try {
    const visitor = classifyVisitor(input.userAgent);
    const query = input.rawSearchQuery?.trim().slice(0, 500);
    const queryHash = query ? createHash("sha256").update(query).digest("hex") : undefined;

    await sql`
      INSERT INTO demand_event (
        event_type, visitor_class, case_id, document_id, referrer_host,
        bot_family, search_query, metadata
      )
      SELECT
        ${input.eventType}::demand_event_type,
        ${visitor.visitorClass}::visitor_class,
        CASE WHEN ${input.targetType ?? null} = 'case' THEN legal_case.id ELSE NULL END,
        CASE WHEN ${input.targetType ?? null} = 'document' THEN document.id ELSE NULL END,
        ${referrerHost(input.referrer)}, ${visitor.botFamily ?? null}, NULL,
        ${sql.json({
          path: input.path.slice(0, 500),
          queryHash,
          queryLength: query?.length,
          privacy: "raw-query-not-stored",
        })}
      FROM (SELECT 1) seed
      LEFT JOIN legal_case ON legal_case.public_id = ${input.targetPublicId ?? null}
      LEFT JOIN document ON document.public_id = ${input.targetPublicId ?? null}
    `;
  } catch (error) {
    console.error("Demand event could not be recorded", error);
  }
}
