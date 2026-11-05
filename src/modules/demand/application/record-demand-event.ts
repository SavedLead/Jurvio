import type postgres from "postgres";
import { classifyVisitor, type VisitorContext } from "../domain/classify-visitor";

type Sql = ReturnType<typeof postgres>;
type EventType = "page_view" | "internal_search" | "document_view" | "explanation_request" | "follow" | "share" | "source_click";
type TargetType = "case" | "document" | "entity" | "court";
type ContentKind = "case" | "document" | "entity" | "court" | "search" | "explainer" | "machine_record";

export interface DemandEventInput {
  eventType: EventType;
  userAgent: string | null;
  referrer: string | null;
  path: string;
  channel?: VisitorContext["channel"];
  internal?: boolean;
  contentKind: ContentKind;
  targetType?: TargetType;
  targetPublicId?: string;
  rawSearchQuery?: string;
  resultCount?: number;
  requestKind?: "explain_case" | "summarize_filing" | "explain_order" | "next_steps";
  /** Request headers: bot signals and the first-party jv_vid / jv_sid cookies (stored only as salted hashes). */
  headers?: Pick<Headers, "get"> | null;
}

export const VISITOR_ID_COOKIE = "jv_vid";
export const SESSION_ID_COOKIE = "jv_sid";

export function cookieId(headers: Pick<Headers, "get"> | null | undefined, name: string): string | null {
  for (const part of (headers?.get("cookie") ?? "").split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === name && v && /^[A-Za-z0-9_-]{16,64}$/.test(v)) return v;
  }
  return null;
}

function referrerHost(value: string | null): string | null {
  if (!value) return null;
  try {
    const hostname = new URL(value).hostname.toLocaleLowerCase("en-US");
    return hostname.startsWith("www.") ? hostname.slice(4, 255) : hostname.slice(0, 255);
  } catch {
    return null;
  }
}

export function analyticsPathTemplate(path: string): string {
  const cleanPath = path.split(/[?#]/, 1)[0]?.slice(0, 500) || "/";
  return cleanPath
    .replace(/\/case\/jv-[a-z0-9]{8,10}/gi, "/case/:caseId")
    .replace(/\/documents\/jd-[a-z0-9]{8,10}/gi, "/documents/:documentId")
    .replace(/\/(?:party|person|organization|attorney|judge|law-firm)\/[^/]+/gi, (match) => `/${match.split("/")[1]}/:entityId`)
    .replace(/\/court\/[^/]+/gi, "/court/:courtId");
}

export function privacySafeSearchDimensions(rawQuery?: string): Record<string, string | number | boolean> {
  const query = rawQuery?.trim();
  if (!query) return {};
  const tokens = query.split(/\s+/).filter(Boolean);
  return {
    queryLengthBucket: query.length < 20 ? "short" : query.length < 80 ? "medium" : "long",
    queryTokenBucket: tokens.length <= 2 ? "1-2" : tokens.length <= 6 ? "3-6" : "7+",
    hasBooleanSyntax: /\b(?:AND|OR|NOT)\b|[()]/.test(query),
    hasCitationShape: /\b\d+\s+[A-Z][A-Za-z.\d]*\s+\d+\b/.test(query),
    hasDocketShape: /\b\d{1,2}:\d{2}-(?:cv|cr|mc)-\d+\b/i.test(query),
  };
}

/**
 * Best-effort telemetry must never make a public legal page fail. This stores no
 * IP address, user-agent, raw query, stable visitor ID, or session recording.
 */
export async function recordDemandEvent(sql: Sql, input: DemandEventInput): Promise<void> {
  try {
    const visitor = classifyVisitor(input.userAgent, {
      channel: input.channel ?? "html",
      internal: input.internal,
      headers: input.headers,
    });
    const visitorId = cookieId(input.headers, VISITOR_ID_COOKIE);
    const sessionId = cookieId(input.headers, SESSION_ID_COOKIE);
    const safeMetadata = {
      pathTemplate: analyticsPathTemplate(input.path),
      channel: input.channel ?? "html",
      contentKind: input.contentKind,
      resultCount: typeof input.resultCount === "number" ? Math.max(0, input.resultCount) : undefined,
      requestKind: input.requestKind,
      ...privacySafeSearchDimensions(input.rawSearchQuery),
      privacyVersion: "first-party-minimal-v2",
    };

    await sql`
      INSERT INTO demand_event (
        event_type, visitor_class, case_id, entity_id, document_id, court_id,
        referrer_host, bot_family, search_query, metadata, visitor_hash, session_hash
      )
      SELECT
        ${input.eventType}::demand_event_type,
        ${visitor.visitorClass}::visitor_class,
        CASE
          WHEN ${input.targetType ?? null} = 'case' THEN legal_case.id
          WHEN ${input.targetType ?? null} = 'document' THEN document.case_id
          ELSE NULL
        END,
        CASE WHEN ${input.targetType ?? null} = 'entity' THEN entity.id ELSE NULL END,
        CASE WHEN ${input.targetType ?? null} = 'document' THEN document.id ELSE NULL END,
        COALESCE(
          CASE WHEN ${input.targetType ?? null} = 'court' THEN direct_court.id ELSE NULL END,
          legal_case.court_id,
          document_case.court_id
        ),
        ${referrerHost(input.referrer)}, ${visitor.botFamily ?? null}, NULL,
        jsonb_strip_nulls(${sql.json(safeMetadata)}::jsonb || jsonb_build_object(
          'jurisdiction', COALESCE(direct_court.jurisdiction, case_court.jurisdiction, document_court.jurisdiction),
          'natureOfSuitCode', COALESCE(legal_case.nature_of_suit_code, document_case.nature_of_suit_code),
          'proceduralPhase', COALESCE(legal_case.procedural_phase, document_case.procedural_phase)
        )),
        demand_id_hash('visitor', ${visitorId}), demand_id_hash('session', ${sessionId})
      FROM (SELECT 1) seed
      LEFT JOIN legal_case ON ${input.targetType ?? null} = 'case' AND legal_case.public_id = ${input.targetPublicId ?? null}
      LEFT JOIN document ON ${input.targetType ?? null} = 'document' AND document.public_id = ${input.targetPublicId ?? null}
      LEFT JOIN legal_case document_case ON document_case.id = document.case_id
      LEFT JOIN entity ON ${input.targetType ?? null} = 'entity' AND entity.public_id = ${input.targetPublicId ?? null}
      LEFT JOIN court direct_court ON ${input.targetType ?? null} = 'court' AND direct_court.public_id = ${input.targetPublicId ?? null}
      LEFT JOIN court case_court ON case_court.id = legal_case.court_id
      LEFT JOIN court document_court ON document_court.id = document_case.court_id
    `;
  } catch (error) {
    console.error("Demand event could not be recorded", error);
  }
}
