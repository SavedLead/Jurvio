/**
 * Writes AI descriptions for Supreme Court emergency applications.
 *
 * Runs on the builder, not on a web host. The workflow exports public docket
 * rows, this process calls OpenAI, and the workflow loads the upserts.
 * Stops before a call that would take the stored spend over $100.
 *
 *   pnpm exec tsx scripts/write-emergency-briefs.ts export-sql
 *   pnpm exec tsx scripts/write-emergency-briefs.ts spent-sql
 *   pnpm exec tsx scripts/write-emergency-briefs.ts write --packets rows.jsonl --spent 0 --limit 5 --out-sql upserts.sql --log costs.jsonl
 *
 * --limit 0 means no count cap (the budget still applies). The key is read
 * from OPENAI_API_KEY and is never printed.
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import {
  BRIEF_BUDGET_USD, BRIEF_PROMPT_VERSION, acceptDescription, budgetAllows, buildBriefPacket, costUsd,
  estimatedCost, exportPacketsSql, parseDescription, renderBriefCall, renderBriefUpsert, spentSql,
  type BriefPacketSource, type StoredBrief,
} from "../src/modules/scotus/domain/emergency-brief";

const args = process.argv.slice(2);
const command = args[0];

if (command === "export-sql") {
  process.stdout.write(exportPacketsSql());
  process.exit(0);
}
if (command === "spent-sql") {
  process.stdout.write(spentSql());
  process.exit(0);
}
if (command !== "write") {
  console.error("usage: write-emergency-briefs.ts export-sql | spent-sql | write --packets --spent --limit --out-sql --log");
  process.exit(1);
}

function flag(name: string): string {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value || value.startsWith("--")) {
    console.error(`missing ${name}`);
    process.exit(1);
  }
  return value;
}

const packetsPath = flag("--packets");
const spentArg = Number(flag("--spent"));
const limit = Number(flag("--limit"));
const outSql = flag("--out-sql");
const logPath = flag("--log");
const apiKey = process.env.OPENAI_API_KEY ?? "";

if (!Number.isFinite(spentArg) || spentArg < 0) {
  console.error("spent must be a non-negative number");
  process.exit(1);
}
if (!Number.isInteger(limit) || limit < 0) {
  console.error("limit must be a non-negative integer (0 means no count cap)");
  process.exit(1);
}
if (!apiKey || /[\r\n]/.test(apiKey)) {
  console.error("OPENAI_API_KEY is not set. Nothing was sent.");
  process.exit(1);
}

function redact(text: string): string {
  return text.split(apiKey).join("[redacted]").slice(0, 400);
}

interface Completion {
  content: string;
  inputTokens: number;
  outputTokens: number;
}

async function complete(model: string, effort: string, system: string, user: string, maxTokens: number): Promise<Completion> {
  const body = {
    model,
    reasoning_effort: effort,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: maxTokens,
  };
  let response: Response | null = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    if (response.status === 401 || response.status === 403) {
      console.error(`OpenAI rejected the key (HTTP ${response.status}). Nothing further was sent.`);
      process.exit(1);
    }
    if (response.status !== 429) break;
    await new Promise((resolve) => setTimeout(resolve, 8_000));
  }
  if (!response) throw new Error("no response");
  const raw = await response.text();
  if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}: ${redact(raw)}`);
  const parsed = JSON.parse(raw) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const content = parsed.choices?.[0]?.message?.content ?? "";
  const inputTokens = parsed.usage?.prompt_tokens;
  const outputTokens = parsed.usage?.completion_tokens;
  if (!Number.isInteger(inputTokens) || !Number.isInteger(outputTokens)) {
    throw new Error("OpenAI response did not include token counts");
  }
  return { content, inputTokens: inputTokens as number, outputTokens: outputTokens as number };
}

function readPackets(path: string): BriefPacketSource[] {
  const text = readFileSync(path, "utf8").trim();
  if (!text) return [];
  return text.split("\n").map((line) => JSON.parse(line) as BriefPacketSource);
}

async function main() {
  const packets = readPackets(packetsPath);
  let spent = spentArg;
  const stored: StoredBrief[] = [];
  const statements: string[] = [];
  let skippedUnchanged = 0;
  let restricted = 0;
  let rejected = 0;
  let skippedFailed = 0;
  let stopped: "budget" | "limit" | "done" = "done";

  writeFileSync(logPath, "");
  for (const packet of packets) {
    if (limit > 0 && stored.length >= limit) {
      stopped = "limit";
      break;
    }
    const built = buildBriefPacket(packet);
    if (built.skipped) {
      restricted += 1;
      continue;
    }
    if (packet.storedHash && packet.storedHash === built.sourceHash) {
      skippedUnchanged += 1;
      continue;
    }
    if (packet.failedHash && packet.failedHash === built.sourceHash) {
      skippedFailed += 1;
      continue;
    }
    const estimate = estimatedCost(built.model, built.user.length);
    if (!budgetAllows(spent, estimate)) {
      stopped = "budget";
      console.error(`Stopping: spent $${spent.toFixed(4)} plus an estimated $${estimate.toFixed(4)} would pass $${BRIEF_BUDGET_USD}.`);
      break;
    }
    let result: Completion;
    try {
      result = await complete(
        built.model.id,
        built.model.reasoningEffort,
        built.system,
        built.user,
        built.briefKind === "extension_line" ? 200 : 2_500,
      );
    } catch (error) {
      rejected += 1;
      console.error(`${packet.docketNumber}: ${error instanceof Error ? error.message : "call failed"}`);
      continue;
    }
    const cost = costUsd(built.model.inputPerMillion, built.model.outputPerMillion, result.inputTokens, result.outputTokens);
    const description = acceptDescription(parseDescription(result.content) ?? "", packet.docketNumber, built.briefKind);
    spent = Math.round((spent + cost) * 1_000_000) / 1_000_000;
    const entry = { docket: packet.docketNumber, model: built.model.id, inputTokens: result.inputTokens, outputTokens: result.outputTokens, costUsd: cost, spentUsd: spent, stored: Boolean(description) };
    appendFileSync(logPath, `${JSON.stringify(entry)}\n`);
    console.log(JSON.stringify(entry));
    const row: StoredBrief = {
      docketNumber: packet.docketNumber,
      briefKind: built.briefKind,
      body: description ?? "Rejected. The public docket was not rewritten.",
      model: built.model.id,
      promptVersion: BRIEF_PROMPT_VERSION,
      sourceHash: built.sourceHash,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd: cost,
      entryCount: packet.entryCount ?? packet.events.length,
      lastEntryOn: /^\d{4}-\d{2}-\d{2}/.test(packet.lastEntryOn ?? "") ? packet.lastEntryOn!.slice(0, 10) : null,
      status: packet.status,
      withheldLines: packet.withheldLines,
    };
    statements.push(renderBriefCall(row, Boolean(description)));
    if (!description) {
      rejected += 1;
      console.error(`${packet.docketNumber}: description rejected (empty, off-docket, or restricted). Cost still counted.`);
      if (spent >= BRIEF_BUDGET_USD) {
        stopped = "budget";
        break;
      }
      continue;
    }
    stored.push(row);
    statements.push(renderBriefUpsert({ ...row, body: description }));
    if (spent >= BRIEF_BUDGET_USD) {
      stopped = "budget";
      break;
    }
  }

  writeFileSync(outSql, statements.length ? `${statements.join("\n")}\n` : "-- nothing to write\n");
  const summary = {
    candidates: packets.length,
    stored: stored.length,
    skippedUnchanged,
    skippedFailed,
    restricted,
    rejected,
    spentBefore: spentArg,
    spentAfter: spent,
    budgetUsd: BRIEF_BUDGET_USD,
    stopped,
    examples: stored.slice(0, 5).map((row) => ({
      docket: row.docketNumber,
      model: row.model,
      costUsd: row.costUsd,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      url: `https://jurvio.com/supreme-court/emergency/${row.docketNumber}`,
      description: row.body,
    })),
  };
  console.log(`SUMMARY ${JSON.stringify(summary)}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? redact(error.message) : "failed");
  process.exit(1);
});
