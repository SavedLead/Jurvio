/**
 * The extra public fields on an emergency application: topics, what is at
 * stake, the order, the two sides' points, and related dockets. Topics and
 * related dockets come from the docket text. The other fields come from the
 * same summary call, or from a fixed template when no call is made.
 */
import { isRestrictedDocketText } from "@/modules/ingestion/domain/federal-stream";
import { classifyEmergencyTopics, relatedEmergencyDockets, type EmergencyTopic } from "./emergency-topics";
import type { BriefPacketSource } from "./emergency-brief";

export interface CaseDetailFields {
  stake: string | null;
  orderExplainer: string | null;
  applicantPoints: string[];
  respondentPoints: string[];
  topics: EmergencyTopic[];
  relatedDockets: string[];
}

function cleanLine(value: unknown, min: number, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length < min || text.length > max) return null;
  if (isRestrictedDocketText(text)) return null;
  return text;
}

function cleanPoints(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const points: string[] = [];
  for (const item of value) {
    const text = cleanLine(item, 12, 280);
    if (text) points.push(text);
    if (points.length === 4) break;
  }
  return points;
}

export function parseCaseDetail(content: string): Omit<CaseDetailFields, "topics" | "relatedDockets"> | null {
  const trimmed = content.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    const parsed = JSON.parse(trimmed) as {
      stake?: unknown;
      order?: unknown;
      applicantPoints?: unknown;
      respondentPoints?: unknown;
    };
    return {
      stake: cleanLine(parsed.stake, 20, 280),
      orderExplainer: cleanLine(parsed.order, 20, 1200),
      applicantPoints: cleanPoints(parsed.applicantPoints),
      respondentPoints: cleanPoints(parsed.respondentPoints),
    };
  } catch {
    return null;
  }
}

export function detailFromPacket(
  source: BriefPacketSource,
  others: readonly BriefPacketSource[],
  modelFields: Omit<CaseDetailFields, "topics" | "relatedDockets"> | null,
): CaseDetailFields {
  const texts = [source.caption, source.applicant ?? "", ...source.events.map((event) => event.description)];
  const topics = classifyEmergencyTopics(texts.join("\n"), { capital: source.capital, kind: source.kind });
  const mentioned = relatedEmergencyDockets(source.docketNumber, texts);
  const numbers = new Set((source.lowerCaseNumbers ?? []).map((value) => value.trim()).filter(Boolean));
  const shared = others
    .filter((other) => other.docketNumber !== source.docketNumber && (other.lowerCaseNumbers ?? []).some((value) => numbers.has(value.trim())))
    .map((other) => other.docketNumber);
  const relatedDockets = [...new Set([...mentioned, ...shared])].slice(0, 8);
  const routineStake = source.kind === "extension"
    ? `${source.applicant?.trim() || "The applicant"} is asking the Supreme Court for more time to file in No. ${source.docketNumber}.`
    : null;
  return {
    stake: modelFields?.stake ?? routineStake ?? null,
    orderExplainer: modelFields?.orderExplainer ?? null,
    applicantPoints: modelFields?.applicantPoints ?? [],
    respondentPoints: modelFields?.respondentPoints ?? [],
    topics,
    relatedDockets,
  };
}

function quote(value: string, salt: string): string {
  let marker = `d${salt}`;
  while (value.includes(`$${marker}$`)) marker += "x";
  return `$${marker}$${value}$${marker}$`;
}

function textArray(values: readonly string[], salt: string): string {
  if (!values.length) return "ARRAY[]::text[]";
  return `ARRAY[${values.map((value, index) => quote(value, `${salt}${index}`)).join(", ")}]`;
}

export function renderDetailUpsert(docketNumber: string, sourceHash: string, detail: CaseDetailFields): string {
  if (!/^[0-9]{2}A[0-9]{1,4}$/.test(docketNumber)) throw new Error("docket number is not an emergency docket");
  if (!/^[a-f0-9]{64}$/.test(sourceHash)) throw new Error("source hash is not sha256");
  const topics = detail.topics.map((topic) => topic.slug);
  const related = detail.relatedDockets.filter((docket) => /^[0-9]{2}A[0-9]{1,4}$/.test(docket) && docket !== docketNumber);
  const stake = detail.stake ? quote(detail.stake, sourceHash.slice(0, 8)) : "NULL";
  const order = detail.orderExplainer ? quote(detail.orderExplainer, sourceHash.slice(8, 16)) : "NULL";
  return `INSERT INTO scotus_application_detail (
  docket_number, topics, stake, order_explainer, applicant_points, respondent_points, related_dockets, source_hash
) VALUES (
  '${docketNumber}', ${textArray(topics, "t")}, ${stake}, ${order},
  ${textArray(detail.applicantPoints, "a")}, ${textArray(detail.respondentPoints, "r")}, ${textArray(related, "k")}, '${sourceHash}'
)
ON CONFLICT (docket_number) DO UPDATE SET
  topics = EXCLUDED.topics,
  stake = EXCLUDED.stake,
  order_explainer = EXCLUDED.order_explainer,
  applicant_points = EXCLUDED.applicant_points,
  respondent_points = EXCLUDED.respondent_points,
  related_dockets = EXCLUDED.related_dockets,
  source_hash = EXCLUDED.source_hash,
  updated_at = now();
`;
}
