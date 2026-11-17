/**
 * Descriptions of Supreme Court emergency applications.
 *
 * Serious applications and federal-government applications go to a model.
 * Extensions of time, and other filings with no facts that need judgment,
 * get a fixed template and no model call. Follower teasers are a separate
 * short text for a future email. Nothing here sends mail or charges anyone.
 *
 * Prices checked against the OpenAI pricing page on 2026-11-17:
 * gpt-6-astra $10 / $50 per million input / output tokens,
 * gpt-6.1-sol $2 / $10, gpt-6-luna $0.10 / $0.50.
 *
 * Through 2026-12-05 the caps are $110 on Astra, then $8 on Sol, with $2
 * held for teasers, and $118 in total. After that date the job spends
 * nothing until BRIEF_BUDGET_AFTER_* is set.
 */
import { createHash } from "node:crypto";
import { isRestrictedDocketText } from "@/modules/ingestion/domain/federal-stream";
import { casePagePath } from "@/modules/scotus/domain/recent-opinions";

export const BRIEF_PROMPT_VERSION = "emergency-brief-v2";
export const TEASER_PROMPT_VERSION = "emergency-teaser-v1";
export const CREDIT_UNTIL = "2026-12-05";
export const SITE_ORIGIN = "https://jurvio.com";

export const TOP_MODEL = { id: "gpt-6-astra", inputPerMillion: 10, outputPerMillion: 50, reasoningEffort: "low", maxOutputTokens: 2500 } as const;
export const MID_MODEL = { id: "gpt-6.1-sol", inputPerMillion: 2, outputPerMillion: 10, reasoningEffort: "low", maxOutputTokens: 2000 } as const;
export const TEASER_MODEL = { id: "gpt-6-luna", inputPerMillion: 0.1, outputPerMillion: 0.5, reasoningEffort: "none", maxOutputTokens: 180 } as const;
export const RULE_MODEL_ID = "rule";

export type DescriptionModel = typeof TOP_MODEL | typeof MID_MODEL;
export type BudgetLane = "top" | "mid" | "teaser";

const LINE_CAP = 900;
const PACKET_CAP = 12_000;
const SERIOUS_KINDS = new Set(["stay", "stay_of_execution", "injunction", "vacate_stay", "bail"]);

export type BriefKind = "full" | "routine" | "teaser";

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
  followed?: boolean;
  storedHash: string | null;
  failedHash?: string | null;
  teaserHash?: string | null;
  events: BriefEvent[];
}

export interface PromptBrief {
  kind: "prompt";
  briefKind: "full";
  model: DescriptionModel;
  system: string;
  user: string;
  sourceHash: string;
}

export interface TemplateBrief {
  kind: "template";
  body: string;
  sourceHash: string;
}

export interface RestrictedBrief {
  kind: "restricted";
}

export type PreparedBrief = PromptBrief | TemplateBrief | RestrictedBrief;

export interface StoredBrief {
  docketNumber: string;
  briefKind: "full" | "routine";
  body: string;
  model: string;
  promptVersion: string;
  sourceHash: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  aiGenerated: boolean;
  entryCount: number;
  lastEntryOn: string | null;
  status: string;
  withheldLines: number;
  lane: "description" | "teaser";
}

export interface BudgetCaps {
  until: string;
  phase: "credit" | "after";
  topUsd: number;
  midUsd: number;
  teaserUsd: number;
  totalUsd: number;
}

export interface Spend {
  top: number;
  mid: number;
  teaser: number;
  total: number;
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

const TEASER_SYSTEM = [
  "You write a one- or two-sentence teaser about one Supreme Court emergency application.",
  "Use only the public docket record in the user message. Never invent a fact.",
  "Include the docket number. Do not mention price, payment, email, or unlocking.",
  "Return JSON only, with one key: {\"description\":\"...\"}.",
].join(" ");

const STATUS_SENTENCE: Record<string, string> = {
  pending: "The public docket shows the request is still pending.",
  granted: "The public docket shows the request was granted.",
  granted_in_part: "The public docket shows the request was granted in part.",
  denied: "The public docket shows the request was denied.",
  withdrawn: "The public docket shows the request was withdrawn.",
  moot: "The public docket shows the request ended as moot.",
  converted: "The public docket shows the request was turned into a full case.",
};

function safeToken(value: string, label: string): string {
  if (!/^[a-z0-9.-]+$/.test(value)) throw new Error(`${label} is not a safe token`);
  return value;
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function costUsd(inputPerMillion: number, outputPerMillion: number, inputTokens: number, outputTokens: number): number {
  return roundUsd((inputTokens * inputPerMillion + outputTokens * outputPerMillion) / 1_000_000);
}

function readUsd(env: Record<string, string | undefined>, name: string, fallback: number | null): number | null {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  return value;
}

/** Caps for the credit window, or the configured caps after it. Unset after-caps stop spend. */
export function budgetCaps(asOf: string, env: Record<string, string | undefined> = process.env): BudgetCaps {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error("asOf must be YYYY-MM-DD");
  const credit = asOf <= CREDIT_UNTIL;
  const caps = credit
    ? {
        until: CREDIT_UNTIL,
        phase: "credit" as const,
        topUsd: readUsd(env, "BRIEF_BUDGET_TOP_USD", 110) ?? 110,
        midUsd: readUsd(env, "BRIEF_BUDGET_MID_USD", 8) ?? 8,
        teaserUsd: readUsd(env, "BRIEF_BUDGET_TEASER_USD", 2) ?? 2,
        totalUsd: readUsd(env, "BRIEF_BUDGET_TOTAL_USD", 118) ?? 118,
      }
    : {
        until: CREDIT_UNTIL,
        phase: "after" as const,
        topUsd: readUsd(env, "BRIEF_BUDGET_AFTER_TOP_USD", null) ?? 0,
        midUsd: readUsd(env, "BRIEF_BUDGET_AFTER_MID_USD", null) ?? 0,
        teaserUsd: readUsd(env, "BRIEF_BUDGET_AFTER_TEASER_USD", null) ?? 0,
        totalUsd: readUsd(env, "BRIEF_BUDGET_AFTER_TOTAL_USD", null) ?? 0,
      };
  const afterUnset = !credit && [env.BRIEF_BUDGET_AFTER_TOP_USD, env.BRIEF_BUDGET_AFTER_MID_USD, env.BRIEF_BUDGET_AFTER_TEASER_USD, env.BRIEF_BUDGET_AFTER_TOTAL_USD].some((value) => value === undefined || value.trim() === "");
  if (afterUnset) return { ...caps, topUsd: 0, midUsd: 0, teaserUsd: 0, totalUsd: 0 };
  for (const [name, value] of [["top", caps.topUsd], ["mid", caps.midUsd], ["teaser", caps.teaserUsd]] as const) {
    if (value > caps.totalUsd) throw new Error(`${name} cap cannot exceed the total cap`);
  }
  return caps;
}

/** True when this call stays inside its lane cap, the total cap, and the teaser reserve. */
export function canSpend(spend: Spend, lane: BudgetLane, estimate: number, caps: BudgetCaps): boolean {
  if (!Number.isFinite(estimate) || estimate < 0) return false;
  const total = roundUsd(spend.total + estimate);
  if (total > caps.totalUsd) return false;
  const laneCap = lane === "top" ? caps.topUsd : lane === "mid" ? caps.midUsd : caps.teaserUsd;
  if (roundUsd(spend[lane] + estimate) > laneCap) return false;
  if (lane !== "teaser" && total > roundUsd(caps.totalUsd - caps.teaserUsd)) return false;
  return true;
}

export function estimatedCost(model: DescriptionModel | typeof TEASER_MODEL, packetChars: number): number {
  const inputTokens = Math.ceil(packetChars / 3) + 500;
  return costUsd(model.inputPerMillion, model.outputPerMillion, inputTokens, model.maxOutputTokens);
}

export function chooseDescriptionLane(spend: Spend, packetChars: number, caps: BudgetCaps, topOnly: boolean): "top" | "mid" | null {
  if (canSpend(spend, "top", estimatedCost(TOP_MODEL, packetChars), caps)) return "top";
  if (topOnly) return null;
  if (canSpend(spend, "mid", estimatedCost(MID_MODEL, packetChars), caps)) return "mid";
  return null;
}

export function addSpend(spend: Spend, lane: BudgetLane, cost: number): Spend {
  return {
    top: lane === "top" ? roundUsd(spend.top + cost) : spend.top,
    mid: lane === "mid" ? roundUsd(spend.mid + cost) : spend.mid,
    teaser: lane === "teaser" ? roundUsd(spend.teaser + cost) : spend.teaser,
    total: roundUsd(spend.total + cost),
  };
}

/** Extensions, and thin unclassified filings, do not need a model. */
export function needsModel(source: BriefPacketSource): boolean {
  if (source.kind === "extension") return false;
  if (source.capital || source.applicantKind === "federal" || source.administration) return true;
  if (SERIOUS_KINDS.has(source.kind)) return true;
  return source.events.some((event) => event.kind === "response_filed" || event.kind === "reply_filed" || event.description.length > 400);
}

export function routineSummary(source: BriefPacketSource): string | null {
  const header = [source.caption, source.applicant ?? "", source.lowerCourt ?? ""].join(" ");
  if (isRestrictedDocketText(header)) return null;
  const party = source.applicant?.replace(/\s+/g, " ").trim() || "A party";
  const status = STATUS_SENTENCE[source.status] ?? "The public docket does not give this request a status Jurvio recognizes.";
  const court = source.lowerCourt ? ` The lower court named on the docket is the ${source.lowerCourt}.` : "";
  const page = `${SITE_ORIGIN}/supreme-court/emergency/${source.docketNumber}`;
  const text = source.kind === "extension"
    ? `${party} asked the Supreme Court for more time to file, No. ${source.docketNumber}.${court} ${status} This summary is taken from the public docket. No model was used. ${page}`
    : `${party} has a filing on the Supreme Court emergency docket, No. ${source.docketNumber}.${court} ${status} The public docket lines do not call for a model summary. No model was used. ${page}`;
  if (isRestrictedDocketText(text) || text.length < 20 || text.length > 6000) return null;
  return text;
}

/** Preview copy for a follower email. It is not a send and it is not a charge. */
export function teaserPreview(body: string): { lead: string; note: string } {
  return {
    lead: `Here's what we found in your case: ${body}`,
    note: "Preview of a future email. Nothing was sent. The line David would still have to approve is: click to unlock the full description for $19. Charging is off.",
  };
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

function recordFor(source: BriefPacketSource): { record: string; pageUrl: string } | null {
  const header = [source.caption, source.applicant ?? "", source.lowerCourt ?? ""].join(" ");
  if (isRestrictedDocketText(header) || isRestrictedDocketText(source.docketNumber)) return null;
  const pageUrl = `${SITE_ORIGIN}/supreme-court/emergency/${source.docketNumber}`;
  const casePath = casePagePath(source.casePublicId);
  const lines = source.events.map((event, index) => {
    if (isRestrictedDocketText(event.description)) {
      return { index, rank: keepRank(event.kind), text: `${event.filedOn ?? "date not stated"} · ${event.kind}: [line withheld]` };
    }
    const line = trimLine(event.description);
    return { index, rank: keepRank(event.kind), text: `${event.filedOn ?? "date not stated"} · ${event.kind}: ${line.text}` };
  });
  const votes = source.votes
    .filter((vote) => !vote.sentence || !isRestrictedDocketText(vote.sentence))
    .map((vote) => vote.sentence?.trim() || [vote.justiceRef, vote.position].filter(Boolean).join(" "))
    .filter((line) => line.length > 0);
  const fit = () => [
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
    record = fit();
  }
  if (record.length > PACKET_CAP) record = `${record.slice(0, PACKET_CAP)}\n[further filings omitted]`;
  return { record, pageUrl };
}

export function prepareBrief(source: BriefPacketSource, model: DescriptionModel): PreparedBrief {
  if (!needsModel(source)) {
    const body = routineSummary(source);
    if (!body) return { kind: "restricted" };
    return { kind: "template", body, sourceHash: createHash("sha256").update(`${BRIEF_PROMPT_VERSION}\n${RULE_MODEL_ID}\n${body}`).digest("hex") };
  }
  const packed = recordFor(source);
  if (!packed) return { kind: "restricted" };
  const user = `Write four to eight sentences covering who asked, what they want paused or allowed, what the lower court did, the arguments on each side, and the Court's action and votes. Include the docket number and cite the Jurvio page URL. Where the record is silent, say the public docket does not say.\n\n${packed.record}`;
  return {
    kind: "prompt",
    briefKind: "full",
    model,
    system: SYSTEM,
    user,
    sourceHash: createHash("sha256").update(`${BRIEF_PROMPT_VERSION}\n${model.id}\n${user}`).digest("hex"),
  };
}

export interface TeaserPrompt {
  kind: "prompt";
  system: string;
  user: string;
  sourceHash: string;
}

export function prepareTeaser(source: BriefPacketSource): TeaserPrompt | RestrictedBrief | null {
  if (!source.followed || !needsModel(source)) return null;
  const packed = recordFor(source);
  if (!packed) return { kind: "restricted" };
  const user = `Write one or two sentences, under 280 characters, saying who asked and what is at stake. Include the docket number.\n\n${packed.record}`;
  return {
    kind: "prompt",
    system: TEASER_SYSTEM,
    user,
    sourceHash: createHash("sha256").update(`${TEASER_PROMPT_VERSION}\n${TEASER_MODEL.id}\n${user}`).digest("hex"),
  };
}

/** Rejects empty, oversized, sealed, or off-docket model output. */
export function acceptDescription(body: string, docketNumber: string, briefKind: BriefKind): string | null {
  const text = body.replace(/\s+/g, " ").trim();
  const max = briefKind === "full" ? 6000 : 400;
  const min = briefKind === "full" ? 40 : 20;
  if (text.length < min || text.length > max) return null;
  if (!text.includes(docketNumber)) return null;
  if (isRestrictedDocketText(text)) return null;
  if (briefKind === "teaser" && /\$|\b(price|payment|email|unlock)\b/i.test(text)) return null;
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
  lastEntryOn: string | null;
  docketNumber: string;
}

/** Newest filing first, then backwards. */
export function compareBriefOrder(a: BriefOrder, b: BriefOrder): number {
  const date = (row: BriefOrder) => (row.lastEntryOn ? Date.parse(row.lastEntryOn) : Number.NEGATIVE_INFINITY);
  return date(b) - date(a) || b.docketNumber.localeCompare(a.docketNumber);
}

export function exportPacketsSql(): string {
  const version = safeToken(BRIEF_PROMPT_VERSION, "prompt version");
  const teaserVersion = safeToken(TEASER_PROMPT_VERSION, "teaser version");
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
    'followed', EXISTS (SELECT 1 FROM case_follow cf WHERE cf.case_id = a.case_id),
    'storedHash', b.source_hash,
    'teaserHash', t.source_hash,
    'failedHash', (
      SELECT failed.source_hash FROM scotus_brief_call failed
      WHERE failed.docket_number = a.docket_number AND NOT failed.stored AND failed.lane = 'description'
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
  LEFT JOIN scotus_application_teaser t ON t.docket_number = a.docket_number
  WHERE b.docket_number IS NULL
     OR b.prompt_version IS DISTINCT FROM '${version}'
     OR b.entry_count IS DISTINCT FROM a.entry_count
     OR b.last_entry_on IS DISTINCT FROM a.last_entry_on
     OR b.status IS DISTINCT FROM a.status
     OR b.withheld_lines IS DISTINCT FROM a.withheld_lines
     OR (
       EXISTS (SELECT 1 FROM case_follow cf WHERE cf.case_id = a.case_id)
       AND (t.docket_number IS NULL OR t.prompt_version IS DISTINCT FROM '${teaserVersion}')
     )
  ORDER BY a.last_entry_on DESC NULLS LAST, a.docket_number DESC
) TO STDOUT;
`;
}

export function spentSql(): string {
  return `SELECT json_build_object(
  'top', coalesce(sum(cost_usd) FILTER (WHERE lane = 'description' AND model = 'gpt-6-astra'), 0),
  'mid', coalesce(sum(cost_usd) FILTER (WHERE lane = 'description' AND model = 'gpt-6.1-sol'), 0),
  'teaser', coalesce(sum(cost_usd) FILTER (WHERE lane = 'teaser'), 0),
  'total', coalesce(sum(cost_usd), 0)
)::text FROM scotus_brief_call;
`;
}

function assertStored(row: StoredBrief): void {
  if (!/^[0-9]{2}A[0-9]{1,4}$/.test(row.docketNumber)) throw new Error("docket number is not an emergency docket");
  if (!/^[a-f0-9]{64}$/.test(row.sourceHash)) throw new Error("source hash is not sha256");
  safeToken(row.promptVersion, "prompt version");
  if (row.model.length < 2 || row.model.length > 80 || /[\r\n']/.test(row.model)) throw new Error("model id is not safe");
  if (!Number.isInteger(row.inputTokens) || !Number.isInteger(row.outputTokens) || row.inputTokens < 0 || row.outputTokens < 0) {
    throw new Error("token counts must be non-negative integers");
  }
  if (!Number.isFinite(row.costUsd) || row.costUsd < 0) throw new Error("cost must be a non-negative number");
}

export function renderBriefCall(row: StoredBrief, stored: boolean): string {
  assertStored(row);
  if (row.lane !== "description" && row.lane !== "teaser") throw new Error("lane is not known");
  return `INSERT INTO scotus_brief_call (docket_number, source_hash, lane, model, input_tokens, output_tokens, cost_usd, stored)
VALUES ('${row.docketNumber}', '${row.sourceHash}', '${row.lane}', '${row.model}', ${row.inputTokens}, ${row.outputTokens}, ${row.costUsd.toFixed(6)}, ${stored ? "true" : "false"});
`;
}

export function renderBriefUpsert(row: StoredBrief): string {
  assertStored(row);
  if (!Number.isInteger(row.entryCount) || row.entryCount < 0 || !Number.isInteger(row.withheldLines) || row.withheldLines < 0) {
    throw new Error("entry counts must be non-negative integers");
  }
  if (!["pending", "granted", "granted_in_part", "denied", "withdrawn", "moot", "converted"].includes(row.status)) {
    throw new Error("status is not a known application status");
  }
  if (row.lastEntryOn !== null && !/^\d{4}-\d{2}-\d{2}$/.test(row.lastEntryOn)) throw new Error("last entry date is not a date");
  if (row.briefKind !== "full" && row.briefKind !== "routine") throw new Error("brief kind is not known");
  let marker = `b${row.sourceHash.slice(0, 16)}`;
  while (row.body.includes(`$${marker}$`)) marker += "x";
  const quote = `$${marker}$${row.body}$${marker}$`;
  return `INSERT INTO scotus_application_brief (
  docket_number, brief_kind, body, model, prompt_version, source_hash, input_tokens, output_tokens, cost_usd,
  ai_generated, entry_count, last_entry_on, status, withheld_lines, generated_at
) VALUES (
  '${row.docketNumber}', '${row.briefKind}', ${quote}, '${row.model}', '${row.promptVersion}',
  '${row.sourceHash}', ${row.inputTokens}, ${row.outputTokens}, ${row.costUsd.toFixed(6)}, ${row.aiGenerated ? "true" : "false"},
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
  ai_generated = EXCLUDED.ai_generated,
  entry_count = EXCLUDED.entry_count,
  last_entry_on = EXCLUDED.last_entry_on,
  status = EXCLUDED.status,
  withheld_lines = EXCLUDED.withheld_lines,
  generated_at = now();
`;
}

export function renderTeaserUpsert(row: StoredBrief): string {
  assertStored(row);
  let marker = `t${row.sourceHash.slice(0, 16)}`;
  while (row.body.includes(`$${marker}$`)) marker += "x";
  const quote = `$${marker}$${row.body}$${marker}$`;
  return `INSERT INTO scotus_application_teaser (
  docket_number, body, model, prompt_version, source_hash, input_tokens, output_tokens, cost_usd, ai_generated, preview_only, generated_at
) VALUES (
  '${row.docketNumber}', ${quote}, '${row.model}', '${row.promptVersion}', '${row.sourceHash}',
  ${row.inputTokens}, ${row.outputTokens}, ${row.costUsd.toFixed(6)}, true, true, now()
)
ON CONFLICT (docket_number) DO UPDATE SET
  body = EXCLUDED.body,
  model = EXCLUDED.model,
  prompt_version = EXCLUDED.prompt_version,
  source_hash = EXCLUDED.source_hash,
  input_tokens = EXCLUDED.input_tokens,
  output_tokens = EXCLUDED.output_tokens,
  cost_usd = EXCLUDED.cost_usd,
  ai_generated = true,
  preview_only = true,
  generated_at = now();
`;
}
