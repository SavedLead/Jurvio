/**
 * Plain-English AI descriptions of Supreme Court emergency applications.
 *
 * The model sees only public docket lines. Lines that match the sealed /
 * restricted filter are left out, and a description that comes back matching
 * that filter is rejected. Nothing here invents a fact: the prompt forbids it,
 * and the stored text is labeled AI-generated with the model and prompt version.
 *
 * Prices checked against the OpenAI pricing page on 2026-11-17:
 * gpt-6.1-sol is $2 / $10 per million input / output tokens,
 * gpt-6-luna is $0.10 / $0.50. Luna is the cheap high-volume model used for
 * one-line extension summaries.
 */
import { createHash } from "node:crypto";
import { isRestrictedDocketText } from "@/modules/ingestion/domain/federal-stream";
import { casePagePath } from "@/modules/scotus/domain/recent-opinions";

export const BRIEF_PROMPT_VERSION = "emergency-brief-v1";
export const BRIEF_BUDGET_USD = 100;
export const SITE_ORIGIN = "https://jurvio.com";

export const SERIOUS_MODEL = { id: "gpt-6.1-sol", inputPerMillion: 2, outputPerMillion: 10, reasoningEffort: "low" } as const;
export const EXTENSION_MODEL = { id: "gpt-6-luna", inputPerMillion: 0.1, outputPerMillion: 0.5, reasoningEffort: "none" } as const;

const LINE_CAP = 900;
const PACKET_CAP = 12_000;

export type BriefKind = "full" | "extension_line";

export interface BriefEvent {
  filedOn: string | null;
  kind: string;
  description: string;
}

export interface BriefVote {
  justiceRef?: string;
  position?: string;
  sentence?: string;
}

export interface BriefPacketSource {
  docketNumber: string;
  caption: string;
  applicant: string | null;
  kind: string;
  capital?: boolean;
  applicantKind: string;
  administration: string | null;
  status: string;
  lowerCourt: string | null;
  lowerCaseNumbers?: string[];
  rulingOn: string | null;
  ruledBy: string | null;
  votes: BriefVote[];
  withheldLines: number;
  entryCount?: number;
  lastEntryOn?: string | null;
  casePublicId: string | null;
  storedHash: string | null;
  failedHash?: string | null;
  events: BriefEvent[];
}

export interface BuiltBrief {
  skipped: null;
  briefKind: BriefKind;
  model: typeof SERIOUS_MODEL | typeof EXTENSION_MODEL;
  system: string;
  user: string;
  sourceHash: string;
  trimmed: boolean;
}

export interface SkippedBrief {
  skipped: "restricted";
  sourceHash: null;
}

export type BriefBuild = BuiltBrief | SkippedBrief;

export interface StoredBrief {
  docketNumber: string;
  briefKind: BriefKind;
  body: string;
  model: string;
  promptVersion: string;
  sourceHash: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  entryCount: number;
  lastEntryOn: string | null;
  status: string;
  withheldLines: number;
}

const SYSTEM = [
  "You write descriptions of U.S. Supreme Court emergency applications for Jurvio, a public legal site.",
  "Use only the public docket record in the user message.",
  "Never invent a party, date, lower-court action, argument, vote, or outcome.",
  "If the record does not say something, write \"The public docket does not say.\"",
  "Do not guess what withheld lines say, and do not mention sealed, restricted, juvenile, or grand-jury material.",
  "The page will label this text AI-generated. It is not a court opinion.",
  "Return JSON only, with one key: {\"description\":\"...\"}.",
].join(" ");

function safeToken(value: string, label: string): string {
  if (!/^[a-z0-9.-]+$/.test(value)) throw new Error(`${label} is not a safe token`);
  return value;
}

export function costUsd(inputPerMillion: number, outputPerMillion: number, inputTokens: number, outputTokens: number): number {
  const cost = (inputTokens * inputPerMillion + outputTokens * outputPerMillion) / 1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

/** True when another call, at the estimated cost, would stay within the cap. */
export function budgetAllows(spentUsd: number, estimatedUsd: number, cap = BRIEF_BUDGET_USD): boolean {
  if (!Number.isFinite(spentUsd) || !Number.isFinite(estimatedUsd) || estimatedUsd < 0) return false;
  return spentUsd + estimatedUsd <= cap;
}

export function estimatedCost(model: typeof SERIOUS_MODEL | typeof EXTENSION_MODEL, packetChars: number): number {
  const inputTokens = Math.ceil(packetChars / 4) + 500;
  const outputTokens = model.id === EXTENSION_MODEL.id ? 120 : 2_000;
  return costUsd(model.inputPerMillion, model.outputPerMillion, inputTokens, outputTokens);
}

function keepRank(kind: string): number {
  if (["granted", "granted_in_part", "denied", "withdrawn", "moot", "converted"].includes(kind)) return 5;
  if (["submitted", "resubmitted", "response_filed", "reply_filed"].includes(kind)) return 4;
  if (["administrative_stay", "response_requested", "referred"].includes(kind)) return 3;
  if (kind === "amicus_filed") return 1;
  return 2;
}

function trimLine(text: string): { text: string; trimmed: boolean } {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= LINE_CAP) return { text: clean, trimmed: false };
  return { text: `${clean.slice(0, LINE_CAP)} [rest of this filing trimmed]`, trimmed: true };
}

export function buildBriefPacket(source: BriefPacketSource): BriefBuild {
  const header = [source.caption, source.applicant ?? "", source.lowerCourt ?? ""].join(" ");
  if (isRestrictedDocketText(header) || isRestrictedDocketText(source.docketNumber)) {
    return { skipped: "restricted", sourceHash: null };
  }
  const extension = source.kind === "extension";
  const model = extension ? EXTENSION_MODEL : SERIOUS_MODEL;
  const pageUrl = `${SITE_ORIGIN}/supreme-court/emergency/${source.docketNumber}`;
  const casePath = casePagePath(source.casePublicId);
  let trimmed = false;
  const lines = source.events.map((event, index) => {
    if (isRestrictedDocketText(event.description)) {
      trimmed = true;
      return { index, rank: keepRank(event.kind), text: `${event.filedOn ?? "date not stated"} · ${event.kind}: [line withheld]` };
    }
    const line = trimLine(event.description);
    if (line.trimmed) trimmed = true;
    return { index, rank: keepRank(event.kind), text: `${event.filedOn ?? "date not stated"} · ${event.kind}: ${line.text}` };
  });
  const votes = source.votes
    .filter((vote) => !vote.sentence || !isRestrictedDocketText(vote.sentence))
    .map((vote) => vote.sentence?.trim() || [vote.justiceRef, vote.position].filter(Boolean).join(" "))
    .filter((line) => line.length > 0);

  const fit = () => {
    const body = [
      `Docket: ${source.docketNumber}`,
      `Caption: ${source.caption}`,
      `Applicant: ${source.applicant ?? "not stated"}`,
      `Request type: ${source.kind}${source.capital ? " (capital case)" : ""}`,
      `Applicant kind: ${source.applicantKind}`,
      source.administration ? `Administration label: ${source.administration}` : null,
      `Status on the public docket: ${source.status}`,
      `Lower court: ${source.lowerCourt ?? "not stated"}`,
      source.lowerCaseNumbers?.length ? `Lower-court numbers: ${source.lowerCaseNumbers.join(", ")}` : null,
      source.rulingOn ? `Ruling date: ${source.rulingOn}${source.ruledBy ? ` (${source.ruledBy})` : ""}` : "Ruling date: not stated",
      `Jurvio page: ${pageUrl}`,
      casePath ? `Jurvio case page: ${SITE_ORIGIN}${casePath}` : "Jurvio case page: none",
      `Withheld docket lines (not included, do not guess): ${source.withheldLines}`,
      votes.length ? `Noted votes:\n${votes.map((vote) => `- ${vote}`).join("\n")}` : "Noted votes: none on the public docket",
      "Public docket lines:",
      ...lines.map((line) => line.text),
    ].filter((line): line is string => line !== null).join("\n");
    return body;
  };

  let record = fit();
  while (record.length > PACKET_CAP) {
    const omitted = "[filing text omitted to stay within the size limit]";
    const target = lines
      .map((line, position) => ({ position, rank: line.rank, index: line.index, text: line.text }))
      .filter((line) => line.rank < 4 && !line.text.endsWith(omitted))
      .sort((a, b) => a.rank - b.rank || b.index - a.index)[0];
    if (!target) break;
    lines[target.position] = {
      ...lines[target.position]!,
      text: `${source.events[target.index]?.filedOn ?? "date not stated"} · ${source.events[target.index]?.kind ?? "other"}: ${omitted}`,
    };
    trimmed = true;
    record = fit();
  }
  if (record.length > PACKET_CAP) {
    record = `${record.slice(0, PACKET_CAP)}\n[further filings omitted]`;
    trimmed = true;
  }

  const task = extension
    ? "Write one sentence, under 280 characters, saying who asked for more time and until when if the record says so. Include the docket number and the Jurvio page URL."
    : "Write four to eight sentences covering who asked, what they want paused or allowed, what the lower court did, the arguments on each side, and the Court's action and votes. Include the docket number and cite the Jurvio page URL. Where the record is silent, say the public docket does not say.";
  const user = `${task}\n\n${record}`;
  const sourceHash = createHash("sha256").update(`${BRIEF_PROMPT_VERSION}\n${model.id}\n${user}`).digest("hex");
  return { skipped: null, briefKind: extension ? "extension_line" : "full", model, system: SYSTEM, user, sourceHash, trimmed };
}

/** Rejects empty, oversized, sealed, or off-docket model output. */
export function acceptDescription(body: string, docketNumber: string, briefKind: BriefKind): string | null {
  const text = body.replace(/\s+/g, " ").trim();
  const max = briefKind === "extension_line" ? 400 : 6000;
  const min = briefKind === "extension_line" ? 20 : 40;
  if (text.length < min || text.length > max) return null;
  if (!text.includes(docketNumber)) return null;
  if (isRestrictedDocketText(text)) return null;
  return text;
}

export function parseDescription(content: string): string | null {
  const trimmed = content.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    const parsed = JSON.parse(trimmed) as { description?: unknown };
    return typeof parsed.description === "string" ? parsed.description : null;
  } catch {
    return null;
  }
}

export interface BriefOrder {
  kind: string;
  applicantKind: string;
  status: string;
  lastEntryOn: string | null;
  docketNumber: string;
}

/** Administration / federal first, then other serious applications pending-first, then extensions. Newest first inside each group. */
export function compareBriefOrder(a: BriefOrder, b: BriefOrder): number {
  const tier = (row: BriefOrder) => (row.kind === "extension" ? 2 : row.applicantKind === "federal" ? 0 : 1);
  const pending = (row: BriefOrder) => (row.status === "pending" ? 0 : 1);
  const date = (row: BriefOrder) => (row.lastEntryOn ? Date.parse(row.lastEntryOn) : Number.NEGATIVE_INFINITY);
  return tier(a) - tier(b) || pending(a) - pending(b) || date(b) - date(a) || b.docketNumber.localeCompare(a.docketNumber);
}

export function exportPacketsSql(): string {
  const version = safeToken(BRIEF_PROMPT_VERSION, "prompt version");
  return `COPY (
  SELECT regexp_replace(json_build_object(
    'docketNumber', a.docket_number,
    'caption', a.caption,
    'applicant', a.applicant,
    'kind', a.kind,
    'capital', a.capital,
    'applicantKind', a.applicant_kind,
    'administration', a.administration,
    'status', a.status,
    'lowerCourt', a.lower_court,
    'lowerCaseNumbers', a.lower_case_numbers,
    'rulingOn', a.ruling_on,
    'ruledBy', a.ruled_by,
    'votes', a.noted_votes,
    'withheldLines', a.withheld_lines,
    'entryCount', a.entry_count,
    'casePublicId', c.public_id,
    'storedHash', b.source_hash,
    'failedHash', (
      SELECT failed.source_hash FROM scotus_brief_call failed
      WHERE failed.docket_number = a.docket_number AND NOT failed.stored
      ORDER BY failed.called_at DESC LIMIT 1
    ),
    'lastEntryOn', a.last_entry_on,
    'events', (
      SELECT coalesce(json_agg(json_build_object(
        'filedOn', e.filed_on,
        'kind', e.kind,
        'description', e.description
      ) ORDER BY e.position), '[]'::json)
      FROM scotus_application_event e
      WHERE e.docket_number = a.docket_number
    )
  )::text, E'[\\n\\r]+', ' ', 'g')
  FROM scotus_application a
  LEFT JOIN legal_case c ON c.id = a.case_id
  LEFT JOIN scotus_application_brief b ON b.docket_number = a.docket_number
  WHERE b.docket_number IS NULL
     OR b.prompt_version IS DISTINCT FROM '${version}'
     OR b.entry_count IS DISTINCT FROM a.entry_count
     OR b.last_entry_on IS DISTINCT FROM a.last_entry_on
     OR b.status IS DISTINCT FROM a.status
     OR b.withheld_lines IS DISTINCT FROM a.withheld_lines
  ORDER BY
    CASE WHEN a.kind = 'extension' THEN 2 WHEN a.applicant_kind = 'federal' THEN 0 ELSE 1 END,
    CASE WHEN a.status = 'pending' THEN 0 ELSE 1 END,
    a.last_entry_on DESC NULLS LAST,
    a.docket_number DESC
) TO STDOUT;
`;
}

export function spentSql(): string {
  return "SELECT coalesce(sum(cost_usd), 0)::text FROM scotus_brief_call;\n";
}

export function renderBriefCall(row: StoredBrief, stored: boolean): string {
  if (!/^[0-9]{2}A[0-9]{1,4}$/.test(row.docketNumber)) throw new Error("docket number is not an emergency docket");
  if (!/^[a-f0-9]{64}$/.test(row.sourceHash)) throw new Error("source hash is not sha256");
  if (row.model.length < 2 || row.model.length > 80 || /[\r\n']/.test(row.model)) throw new Error("model id is not safe");
  return `INSERT INTO scotus_brief_call (docket_number, source_hash, model, input_tokens, output_tokens, cost_usd, stored)
VALUES ('${row.docketNumber}', '${row.sourceHash}', '${row.model}', ${row.inputTokens}, ${row.outputTokens}, ${row.costUsd.toFixed(6)}, ${stored ? "true" : "false"});
`;
}

export function renderBriefUpsert(row: StoredBrief): string {
  if (!/^[0-9]{2}A[0-9]{1,4}$/.test(row.docketNumber)) throw new Error("docket number is not an emergency docket");
  if (!/^[a-f0-9]{64}$/.test(row.sourceHash)) throw new Error("source hash is not sha256");
  safeToken(row.promptVersion, "prompt version");
  if (row.model.length < 2 || row.model.length > 80 || /[\r\n]/.test(row.model)) throw new Error("model id is not safe");
  if (!Number.isInteger(row.inputTokens) || !Number.isInteger(row.outputTokens) || row.inputTokens < 0 || row.outputTokens < 0) {
    throw new Error("token counts must be non-negative integers");
  }
  if (!Number.isFinite(row.costUsd) || row.costUsd < 0) throw new Error("cost must be a non-negative number");
  if (!Number.isInteger(row.entryCount) || row.entryCount < 0 || !Number.isInteger(row.withheldLines) || row.withheldLines < 0) {
    throw new Error("entry counts must be non-negative integers");
  }
  if (!["pending", "granted", "granted_in_part", "denied", "withdrawn", "moot", "converted"].includes(row.status)) {
    throw new Error("status is not a known application status");
  }
  if (row.lastEntryOn !== null && !/^\d{4}-\d{2}-\d{2}$/.test(row.lastEntryOn)) throw new Error("last entry date is not a date");
  let marker = `b${row.sourceHash.slice(0, 16)}`;
  while (row.body.includes(`$${marker}$`)) marker += "x";
  const quote = `$${marker}$${row.body}$${marker}$`;
  return `INSERT INTO scotus_application_brief (
  docket_number, brief_kind, body, model, prompt_version, source_hash, input_tokens, output_tokens, cost_usd,
  ai_generated, entry_count, last_entry_on, status, withheld_lines, generated_at
) VALUES (
  '${row.docketNumber}', '${row.briefKind}', ${quote}, '${row.model.replaceAll("'", "''")}', '${row.promptVersion}',
  '${row.sourceHash}', ${row.inputTokens}, ${row.outputTokens}, ${row.costUsd.toFixed(6)}, true,
  ${row.entryCount}, ${row.lastEntryOn ? `'${row.lastEntryOn}'` : "NULL"}, '${row.status}', ${row.withheldLines}, now()
)
ON CONFLICT (docket_number) DO UPDATE SET
  brief_kind = EXCLUDED.brief_kind,
  body = EXCLUDED.body,
  model = EXCLUDED.model,
  prompt_version = EXCLUDED.prompt_version,
  source_hash = EXCLUDED.source_hash,
  input_tokens = EXCLUDED.input_tokens,
  output_tokens = EXCLUDED.output_tokens,
  cost_usd = EXCLUDED.cost_usd,
  ai_generated = true,
  entry_count = EXCLUDED.entry_count,
  last_entry_on = EXCLUDED.last_entry_on,
  status = EXCLUDED.status,
  withheld_lines = EXCLUDED.withheld_lines,
  generated_at = now();
`;
}
