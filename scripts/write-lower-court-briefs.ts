/**
 * Descriptions for published court of appeals cases, newest first, then
 * district cases the same way. Uses gpt-6.1-sol only. gpt-6-astra is not
 * called. A case whose filings are all routine is skipped. A budget of 0
 * spends nothing. This process does not send email.
 *
 *   pnpm exec tsx scripts/write-lower-court-briefs.ts export-sql
 *   pnpm exec tsx scripts/write-lower-court-briefs.ts spent-sql
 *   LOWER_COURT_BUDGET_USD=0 pnpm exec tsx scripts/write-lower-court-briefs.ts write --packets rows.jsonl --spent spent.txt --out-sql upserts.sql
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { isRoutineFiling } from "../src/modules/cases/domain/routine-filing";
import { isRestrictedDocketText } from "../src/modules/ingestion/domain/federal-stream";

const MODEL = "gpt-6.1-sol";
const INPUT_PER_MILLION = 2;
const OUTPUT_PER_MILLION = 10;
const PROMPT_VERSION = "lower-court-v1";
const MAX_INPUT_CHARS = 8_000;
const MAX_OUTPUT_TOKENS = 800;

const args = process.argv.slice(2);
const command = args[0];

function flag(name: string): string {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value) {
    console.error(`Missing ${name}`);
    process.exit(1);
  }
  return value;
}

function laneClause(lane: string): string {
  if (lane === "circuit") return "(court.jurisdiction = 'f' OR court.jurisdiction ILIKE '%appellate%')";
  if (lane === "district") return "(court.jurisdiction = 'fd' OR court.jurisdiction ILIKE '%district%')";
  if (lane === "both") {
    return "((court.jurisdiction = 'f' OR court.jurisdiction ILIKE '%appellate%') OR (court.jurisdiction = 'fd' OR court.jurisdiction ILIKE '%district%'))";
  }
  console.error("lane must be circuit, district, or both");
  process.exit(1);
}

function exportSql(lane: string): string {
  const where = laneClause(lane);
  return `COPY (
  SELECT regexp_replace(json_build_object(
    'caseId', c.id,
    'publicId', c.public_id,
    'docketNumber', c.docket_number,
    'caption', c.caption,
    'court', court.short_name,
    'level', CASE
      WHEN court.jurisdiction = 'f' OR court.jurisdiction ILIKE '%appellate%' THEN 'circuit'
      ELSE 'district'
    END,
    'events', (
      SELECT coalesce(json_agg(json_build_object(
        'filedOn', e.filed_on,
        'description', e.description
      ) ORDER BY e.filed_on DESC NULLS LAST), '[]'::json)
      FROM (
        SELECT filed_on, description
        FROM docket_entry
        WHERE case_id = c.id
        ORDER BY filed_on DESC NULLS LAST
        LIMIT 40
      ) e
    )
  )::text, E'[\\n\\r]+', ' ', 'g')
  FROM legal_case c
  JOIN court ON court.id = c.court_id
  LEFT JOIN case_description d ON d.case_id = c.id
  WHERE c.publication = 'published'
    AND coalesce(court.provider_court_id, '') <> 'scotus'
    AND d.case_id IS NULL
    AND ${where}
  ORDER BY CASE
      WHEN court.jurisdiction = 'f' OR court.jurisdiction ILIKE '%appellate%' THEN 0
      ELSE 1
    END,
    (SELECT max(e.filed_on) FROM docket_entry e WHERE e.case_id = c.id) DESC NULLS LAST,
    c.public_id
  LIMIT 400
) TO STDOUT;
`;
}

if (command === "export-sql") {
  process.stdout.write(exportSql(process.env.LANE ?? "both"));
  process.exit(0);
}
if (command === "spent-sql") {
  process.stdout.write("SELECT coalesce(sum(cost_usd), 0)::text FROM case_description_call;\n");
  process.exit(0);
}
if (command !== "write") {
  console.error("Use export-sql, spent-sql, or write.");
  process.exit(1);
}

const budget = Number(process.env.LOWER_COURT_BUDGET_USD ?? "0");
if (!Number.isFinite(budget) || budget < 0) {
  console.error("LOWER_COURT_BUDGET_USD must be a non-negative number.");
  process.exit(1);
}
if (budget === 0) {
  console.log(`SUMMARY ${JSON.stringify({ written: 0, spentUsd: 0, stopped: "budget", note: "Budget is 0. No model was called." })}`);
  process.exit(0);
}

const apiKey = process.env.OPENAI_API_KEY ?? "";
if (!apiKey || /[\r\n]/.test(apiKey)) {
  console.error("OPENAI_API_KEY is not set. Nothing was sent.");
  process.exit(1);
}

interface EventLine { filedOn: string | null; description: string }
interface Packet {
  caseId: string;
  publicId: string;
  docketNumber: string;
  caption: string;
  court: string | null;
  level: "circuit" | "district";
  events: EventLine[];
}

function readPackets(path: string): Packet[] {
  return readFileSync(path, "utf8").split("\n").map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line) as Packet);
}

function cost(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * INPUT_PER_MILLION + (outputTokens / 1_000_000) * OUTPUT_PER_MILLION;
}

function quote(body: string, hash: string): string {
  let marker = `c${hash.slice(0, 16)}`;
  while (body.includes(`$${marker}$`)) marker += "x";
  return `$${marker}$${body}$${marker}$`;
}

async function complete(system: string, user: string): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      response_format: { type: "json_object" },
      max_completion_tokens: MAX_OUTPUT_TOKENS,
    }),
  });
  if (!response.ok) throw new Error(`model HTTP ${response.status}`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  return {
    content: payload.choices?.[0]?.message?.content ?? "",
    inputTokens: payload.usage?.prompt_tokens ?? 0,
    outputTokens: payload.usage?.completion_tokens ?? 0,
  };
}

async function main(): Promise<void> {
  const packets = readPackets(flag("--packets"));
  const already = Number(readFileSync(flag("--spent"), "utf8").trim() || "0");
  const outPath = flag("--out-sql");
  let spent = Number.isFinite(already) ? already : 0;
  const statements: string[] = [];
  let written = 0;
  let skippedRoutine = 0;
  let restricted = 0;
  let stopped: "budget" | "done" = "done";

  for (const packet of packets) {
    if (!/^[0-9a-f-]{36}$/i.test(packet.caseId)) continue;
    const kept = packet.events.filter((event) => event.description && !isRoutineFiling(event.description));
    if (kept.length === 0) {
      skippedRoutine += 1;
      continue;
    }
    const lines = kept.map((event) => `${event.filedOn ?? "undated"}: ${event.description.replace(/\s+/g, " ").trim()}`);
    const packetText = `${packet.caption}\n${lines.join("\n")}`;
    if (isRestrictedDocketText(packetText)) {
      restricted += 1;
      continue;
    }
    let user = [
      `Court: ${packet.court ?? packet.level}. Docket: ${packet.docketNumber}.`,
      `Caption: ${packet.caption}`,
      "Docket lines, newest first:",
      ...lines,
    ].join("\n");
    if (user.length > MAX_INPUT_CHARS) user = user.slice(0, MAX_INPUT_CHARS);
    const reserve = cost(Math.ceil(user.length / 4) + 400, MAX_OUTPUT_TOKENS);
    if (spent + reserve > budget) {
      stopped = "budget";
      break;
    }
    const system = "You write a short plain-English description of a federal case from the docket lines you are given. Use only those lines. Do not invent holdings, quotes, or outcomes. If the lines do not say how the case came out, say that. Reply as JSON with one key, description.";
    const result = await complete(system, user);
    let parsed = "";
    try {
      const json = JSON.parse(result.content) as { description?: unknown };
      parsed = typeof json.description === "string" ? json.description : "";
    } catch {
      parsed = "";
    }
    const body = parsed.replace(/\s+/g, " ").trim();
    const dollars = cost(result.inputTokens, result.outputTokens);
    spent = Math.round((spent + dollars) * 1_000_000) / 1_000_000;
    if (body.length < 20 || body.length > 4000 || isRestrictedDocketText(body)) {
      statements.push(`INSERT INTO case_description_call (case_id, model, input_tokens, output_tokens, cost_usd, stored) VALUES ('${packet.caseId}', '${MODEL}', ${result.inputTokens}, ${result.outputTokens}, ${dollars.toFixed(6)}, false);`);
      continue;
    }
    const hash = createHash("sha256").update(`${PROMPT_VERSION}\n${user}`).digest("hex");
    const last = kept.find((event) => event.filedOn && /^\d{4}-\d{2}-\d{2}/.test(event.filedOn))?.filedOn?.slice(0, 10) ?? null;
    statements.push(`INSERT INTO case_description_call (case_id, model, input_tokens, output_tokens, cost_usd, stored) VALUES ('${packet.caseId}', '${MODEL}', ${result.inputTokens}, ${result.outputTokens}, ${dollars.toFixed(6)}, true);`);
    statements.push(`INSERT INTO case_description (
      case_id, body, model, prompt_version, source_hash, input_tokens, output_tokens, cost_usd, entry_count, last_entry_on
    ) VALUES (
      '${packet.caseId}', ${quote(body, hash)}, '${MODEL}', '${PROMPT_VERSION}', '${hash}',
      ${result.inputTokens}, ${result.outputTokens}, ${dollars.toFixed(6)}, ${kept.length}, ${last ? `'${last}'` : "NULL"}
    ) ON CONFLICT (case_id) DO NOTHING;`);
    written += 1;
    console.log(JSON.stringify({ caseId: packet.publicId, level: packet.level, costUsd: dollars, totalUsd: spent, stored: true }));
    if (spent >= budget) {
      stopped = "budget";
      break;
    }
  }
  writeFileSync(outPath, statements.length > 0 ? `${statements.join("\n")}\n` : "");
  console.log(`SUMMARY ${JSON.stringify({ written, skippedRoutine, restricted, spentUsd: Math.round((spent - already) * 1_000_000) / 1_000_000, stopped })}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "failed";
  console.error(message.split(apiKey).join("[redacted]").slice(0, 400));
  process.exit(1);
});
