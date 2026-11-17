/**
 * Writes descriptions for Supreme Court emergency applications.
 *
 * Runs on the builder, not on a web host. The final SCOTUS model is not
 * picked yet. compare writes gpt-6-astra and gpt-6.1-sol and stores nothing.
 * showcase stores both on the public page. A later backlog still prefers
 * Astra until David picks. gpt-6-luna is teasers only. Extensions and other
 * routine filings get a template and no model call. This process does not
 * send email.
 *
 *   pnpm exec tsx scripts/write-emergency-briefs.ts export-sql
 *   pnpm exec tsx scripts/write-emergency-briefs.ts spent-sql
 *   pnpm exec tsx scripts/write-emergency-briefs.ts write --packets rows.jsonl --spent spend.json --limit 5 --top-only --out-sql upserts.sql --log costs.jsonl
 *
 * --limit 0 means no count cap on model descriptions. --top-only stays on
 * Astra. --teasers writes follower previews. OPENAI_API_KEY is never printed.
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { loadFilingExcerpts } from "../src/modules/scotus/application/load-filing-excerpts";
import {
  BACKLOG_CASES, BRIEF_PROMPT_VERSION, MESSY_COMPARE_DOCKETS, TEASER_MODEL, TEASER_PROMPT_VERSION, TOP_MODEL, MID_MODEL, RULE_MODEL_ID,
  acceptDescription, addSpend, budgetCaps, canSpend, chooseDescriptionLane, costUsd, estimatedCost,
  exportCompareSql, exportPacketsSql, filingBacklogCost, needsModel, parseDescription, prepareBrief, prepareTeaser, renderBriefCall, worstCaseBriefCost,
  renderBriefUpsert, renderTeaserUpsert, spentSql,
  type BriefPacketSource, type FilingExcerpt, type Spend, type StoredBrief,
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
if (command === "export-compare-sql") {
  const fromEnv = (process.env.DOCKETS ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  process.stdout.write(exportCompareSql(fromEnv));
  process.exit(0);
}
if (command === "messy-dockets") {
  process.stdout.write(MESSY_COMPARE_DOCKETS.join(","));
  process.exit(0);
}
if (command === "compare") {
  try {
    await runCompare();
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? redact(error.message) : "compare failed");
    process.exit(1);
  }
}
if (command !== "write") {
  console.error("usage: write-emergency-briefs.ts export-sql | export-compare-sql | spent-sql | compare --packets --out | write --packets --spent --limit --out-sql --log [--top-only] [--teasers]");
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
const spentPath = flag("--spent");
const limit = Number(flag("--limit"));
const outSql = flag("--out-sql");
const logPath = flag("--log");
const topOnly = args.includes("--top-only");
const writeTeasers = args.includes("--teasers");
const apiKey = process.env.OPENAI_API_KEY ?? "";
const asOf = new Date().toISOString().slice(0, 10);
const caps = budgetCaps(asOf);

if (!Number.isInteger(limit) || limit < 0) {
  console.error("limit must be a non-negative integer (0 means no count cap)");
  process.exit(1);
}
if (!apiKey || /[\r\n]/.test(apiKey)) {
  console.error("OPENAI_API_KEY is not set. Nothing was sent.");
  process.exit(1);
}

function apiKeyValue(): string {
  const key = process.env.OPENAI_API_KEY ?? "";
  if (!key || /[\r\n]/.test(key)) {
    console.error("OPENAI_API_KEY is not set. Nothing was sent.");
    process.exit(1);
  }
  return key;
}

function redact(text: string): string {
  return text.split(apiKeyValue()).join("[redacted]").slice(0, 400);
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
      headers: { authorization: `Bearer ${apiKeyValue()}`, "content-type": "application/json" },
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
  if (!Number.isInteger(inputTokens) || !Number.isInteger(outputTokens)) throw new Error("OpenAI response did not include token counts");
  return { content, inputTokens: inputTokens as number, outputTokens: outputTokens as number };
}

function readPackets(path: string): BriefPacketSource[] {
  const text = readFileSync(path, "utf8").trim();
  if (!text) return [];
  return text.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as BriefPacketSource);
}

function readSpend(path: string): Spend {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<Spend>;
  const spend = {
    top: Number(parsed.top ?? 0),
    mid: Number(parsed.mid ?? 0),
    teaser: Number(parsed.teaser ?? 0),
    total: Number(parsed.total ?? 0),
  };
  if ([spend.top, spend.mid, spend.teaser, spend.total].some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("spend file is not a non-negative total");
  }
  return spend;
}

function dates(packet: BriefPacketSource): Pick<StoredBrief, "entryCount" | "lastEntryOn" | "status" | "withheldLines"> {
  return {
    entryCount: packet.entryCount ?? packet.events.length,
    lastEntryOn: /^\d{4}-\d{2}-\d{2}/.test(packet.lastEntryOn ?? "") ? packet.lastEntryOn!.slice(0, 10) : null,
    status: packet.status,
    withheldLines: packet.withheldLines,
  };
}

async function main() {
  const packets = readPackets(packetsPath);
  let spend = readSpend(spentPath);
  const stored: StoredBrief[] = [];
  const statements: string[] = [];
  let skippedUnchanged = 0;
  let restricted = 0;
  let rejected = 0;
  let skippedFailed = 0;
  let templates = 0;
  let teasers = 0;
  let stopped: "budget" | "limit" | "done" = caps.totalUsd === 0 ? "budget" : "done";
  let described = 0;

  writeFileSync(logPath, "");
  if (caps.phase === "after" && caps.totalUsd === 0) {
    console.error("After the credit date, set BRIEF_BUDGET_AFTER_TOP_USD, BRIEF_BUDGET_AFTER_MID_USD, BRIEF_BUDGET_AFTER_TEASER_USD, and BRIEF_BUDGET_AFTER_TOTAL_USD before spending.");
  }

  for (const packet of packets) {
    if (!needsModel(packet)) {
      const prepared = prepareBrief(packet, TOP_MODEL);
      if (prepared.kind === "restricted") {
        restricted += 1;
        continue;
      }
      if (prepared.kind !== "template") continue;
      if (packet.storedHash === prepared.sourceHash) {
        skippedUnchanged += 1;
        continue;
      }
      const row: StoredBrief = {
        docketNumber: packet.docketNumber, briefKind: "routine", body: prepared.body, model: RULE_MODEL_ID,
        promptVersion: BRIEF_PROMPT_VERSION, sourceHash: prepared.sourceHash, inputTokens: 0, outputTokens: 0,
        costUsd: 0, aiGenerated: false, lane: "description", ...dates(packet),
      };
      statements.push(renderBriefUpsert(row));
      templates += 1;
      continue;
    }
    if (limit > 0 && described >= limit) {
      stopped = "limit";
      continue;
    }
    if (stopped === "budget") continue;
    const probe = prepareBrief(packet, TOP_MODEL);
    if (probe.kind === "restricted") {
      restricted += 1;
      continue;
    }
    if (probe.kind !== "prompt") continue;
    const lane = chooseDescriptionLane(spend, probe.user.length, caps, topOnly);
    if (!lane) {
      stopped = "budget";
      console.error(`Stopping descriptions: top $${spend.top.toFixed(4)}, mid $${spend.mid.toFixed(4)}, total $${spend.total.toFixed(4)}.`);
      continue;
    }
    const model = lane === "top" ? TOP_MODEL : MID_MODEL;
    const prepared = lane === "top" ? probe : prepareBrief(packet, model);
    if (prepared.kind !== "prompt") continue;
    if (packet.storedHash === prepared.sourceHash) {
      skippedUnchanged += 1;
      continue;
    }
    if (packet.failedHash === prepared.sourceHash) {
      skippedFailed += 1;
      continue;
    }
    let result: Completion;
    try {
      result = await complete(model.id, model.reasoningEffort, prepared.system, prepared.user, model.maxOutputTokens);
    } catch (error) {
      rejected += 1;
      console.error(`${packet.docketNumber}: ${error instanceof Error ? error.message : "call failed"}`);
      continue;
    }
    const cost = costUsd(model.inputPerMillion, model.outputPerMillion, result.inputTokens, result.outputTokens);
    const description = acceptDescription(parseDescription(result.content) ?? "", packet.docketNumber, "full");
    spend = addSpend(spend, lane, cost);
    const entry = { docket: packet.docketNumber, lane, model: model.id, inputTokens: result.inputTokens, outputTokens: result.outputTokens, costUsd: cost, totalUsd: spend.total, stored: Boolean(description) };
    appendFileSync(logPath, `${JSON.stringify(entry)}\n`);
    console.log(JSON.stringify(entry));
    const row: StoredBrief = {
      docketNumber: packet.docketNumber, briefKind: "full", body: description ?? "Rejected. The public docket was not rewritten.",
      model: model.id, promptVersion: BRIEF_PROMPT_VERSION, sourceHash: prepared.sourceHash,
      inputTokens: result.inputTokens, outputTokens: result.outputTokens, costUsd: cost, aiGenerated: true,
      lane: "description", ...dates(packet),
    };
    statements.push(renderBriefCall(row, Boolean(description)));
    if (!description) {
      rejected += 1;
      console.error(`${packet.docketNumber}: description rejected (empty, off-docket, or restricted). Cost still counted.`);
      continue;
    }
    described += 1;
    stored.push({ ...row, body: description });
    statements.push(renderBriefUpsert({ ...row, body: description }));
  }

  if (writeTeasers) {
    for (const packet of packets) {
      const prepared = prepareTeaser(packet);
      if (!prepared || prepared.kind === "restricted") continue;
      if (packet.teaserHash === prepared.sourceHash) continue;
      if (!canSpend(spend, "teaser", estimatedCost(TEASER_MODEL, prepared.user.length), caps)) {
        console.error(`Stopping teasers: teaser $${spend.teaser.toFixed(4)}, total $${spend.total.toFixed(4)}.`);
        break;
      }
      let result: Completion;
      try {
        result = await complete(TEASER_MODEL.id, TEASER_MODEL.reasoningEffort, prepared.system, prepared.user, TEASER_MODEL.maxOutputTokens);
      } catch (error) {
        rejected += 1;
        console.error(`${packet.docketNumber} teaser: ${error instanceof Error ? error.message : "call failed"}`);
        continue;
      }
      const cost = costUsd(TEASER_MODEL.inputPerMillion, TEASER_MODEL.outputPerMillion, result.inputTokens, result.outputTokens);
      const description = acceptDescription(parseDescription(result.content) ?? "", packet.docketNumber, "teaser");
      spend = addSpend(spend, "teaser", cost);
      console.log(JSON.stringify({ docket: packet.docketNumber, lane: "teaser", model: TEASER_MODEL.id, inputTokens: result.inputTokens, outputTokens: result.outputTokens, costUsd: cost, totalUsd: spend.total, stored: Boolean(description) }));
      const row: StoredBrief = {
        docketNumber: packet.docketNumber, briefKind: "full", body: description ?? "Rejected teaser.",
        model: TEASER_MODEL.id, promptVersion: TEASER_PROMPT_VERSION, sourceHash: prepared.sourceHash,
        inputTokens: result.inputTokens, outputTokens: result.outputTokens, costUsd: cost, aiGenerated: true,
        lane: "teaser", ...dates(packet),
      };
      statements.push(renderBriefCall(row, Boolean(description)));
      if (!description) {
        rejected += 1;
        continue;
      }
      teasers += 1;
      statements.push(renderTeaserUpsert({ ...row, body: description }));
    }
  }

  writeFileSync(outSql, statements.length ? `${statements.join("\n")}\n` : "-- nothing to write\n");
  const summary = {
    candidates: packets.length,
    stored: stored.length,
    templates,
    teasers,
    skippedUnchanged,
    skippedFailed,
    restricted,
    rejected,
    spend,
    caps,
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

async function runCompare(): Promise<void> {
  const packets = readPackets(flag("--packets"));
  const outPath = flag("--out");
  const limitArg = args.includes("--limit") ? Number(flag("--limit")) : 5;
  if (!Number.isInteger(limitArg) || limitArg < 1 || limitArg > 5) {
    console.error("compare limit must be 1-5");
    process.exit(1);
  }
  const requested = args.includes("--dockets")
    ? flag("--dockets").split(",").map((item) => item.trim()).filter(Boolean)
    : [];
  const byDocket = new Map(packets.map((packet) => [packet.docketNumber, packet]));
  const missing = requested.filter((docket) => !byDocket.has(docket));
  if (missing.length > 0) console.error(`These dockets were not in the packet export: ${missing.join(", ")}`);
  const chosen = requested.length > 0
    ? requested.flatMap((docket) => {
      const packet = byDocket.get(docket);
      return packet ? [packet] : [];
    }).slice(0, 5)
    : packets.filter(needsModel).slice(0, limitArg);
  if (chosen.length === 0) {
    console.error("No applications matched this compare.");
    process.exit(1);
  }
  const storePath = args.includes("--out-sql") ? flag("--out-sql") : "";
  const loadedCases = [];
  for (const packet of chosen) {
    const loaded = await loadFilingExcerpts(packet.docketNumber);
    loadedCases.push({ packet, loaded });
    console.log(JSON.stringify({
      docket: packet.docketNumber,
      jsonUrl: loaded.jsonUrl,
      httpStatus: loaded.httpStatus,
      bytes: loaded.bytes,
      contentType: loaded.contentType,
      rawLinks: loaded.rawLinks,
      keptLinks: loaded.keptLinks,
      pdfs: loaded.pdfs,
      pdfCount: loaded.filings.length,
      extractedChars: loaded.filings.reduce((sum, filing) => sum + filing.chars, 0),
      ocrPages: loaded.filings.reduce((sum, filing) => sum + (filing.ocrPages ?? 0), 0),
      worstCaseUsd: worstCaseBriefCost(loaded.filings.reduce((sum, filing) => sum + filing.chars, 0) + 2_000).usd,
      note: loaded.note,
      stored: storePath !== "",
    }));
  }
  const withPdfText = loadedCases.filter(({ loaded }) => loaded.filings.some((filing) => filing.chars > 0)).length;
  if (withPdfText === 0) {
    const blocked = loadedCases.some(({ loaded }) => loaded.blocked);
    console.error("No case received filing PDF text. No model was called, so this run spent $0.");
    if (blocked) {
      console.error("supremecourt.gov did not return case JSON to this builder. The runner is likely blocked.");
      console.error("Free alternative: a GitHub-hosted ubuntu-latest step that only downloads these JSON feeds and PDFs and uploads filing-text.json as an artifact. The builder job would read that artifact and would not call supremecourt.gov. Do not run the model on the hosted runner. This repo's workflow policy currently forbids ubuntu-latest except for a few recovery workflows, so that step needs an explicit exception.");
    }
    writeFileSync(outPath, "# Emergency description comparison\n\nNo filing PDF text. No model was called. Spend: $0.\n");
    process.exit(1);
  }
  const cases: Array<Record<string, unknown>> = [];
  const statements: string[] = [];
  let total = 0;
  for (const { packet, loaded } of loadedCases) {
    const prepared = prepareBrief({ ...packet, filings: loaded.filings }, TOP_MODEL);
    if (prepared.kind !== "prompt") continue;
    const models = [TOP_MODEL, MID_MODEL] as const;
    const results: Array<Record<string, unknown>> = [];
    let wrotePrimary = false;
    for (const model of models) {
      try {
        const result = await complete(model.id, model.reasoningEffort, prepared.system, prepared.user, model.maxOutputTokens);
        const cost = costUsd(model.inputPerMillion, model.outputPerMillion, result.inputTokens, result.outputTokens);
        total = Math.round((total + cost) * 1_000_000) / 1_000_000;
        const raw = parseDescription(result.content) ?? result.content;
        const description = acceptDescription(raw, packet.docketNumber, "full");
        results.push({
          model: model.id, inputTokens: result.inputTokens, outputTokens: result.outputTokens, costUsd: cost,
          description: description ?? raw, rejected: !description,
        });
        console.log(JSON.stringify({ docket: packet.docketNumber, model: model.id, inputTokens: result.inputTokens, outputTokens: result.outputTokens, costUsd: cost, totalUsd: total, stored: storePath !== "" && Boolean(description) }));
        if (storePath && description) {
          const forModel = prepareBrief({ ...packet, filings: loaded.filings }, model);
          if (forModel.kind === "prompt") {
            const row: StoredBrief = {
              docketNumber: packet.docketNumber, briefKind: "full", body: description, model: model.id,
              promptVersion: BRIEF_PROMPT_VERSION, sourceHash: forModel.sourceHash, inputTokens: result.inputTokens,
              outputTokens: result.outputTokens, costUsd: cost, aiGenerated: true, lane: "description", ...dates(packet),
            };
            const table = wrotePrimary ? "scotus_application_brief_alt" : "scotus_application_brief";
            wrotePrimary = true;
            statements.push(renderBriefCall(row, true));
            statements.push(renderBriefUpsert(row, table));
          }
        }
      } catch (error) {
        results.push({ model: model.id, error: error instanceof Error ? error.message : "call failed" });
        console.error(`${packet.docketNumber} ${model.id}: ${error instanceof Error ? error.message : "call failed"}`);
      }
    }
    cases.push({
      docketNumber: packet.docketNumber,
      caption: packet.caption,
      kind: packet.kind,
      status: packet.status,
      applicant: packet.applicant,
      administration: packet.administration,
      lowerCourt: packet.lowerCourt,
      url: `https://jurvio.com/supreme-court/emergency/${packet.docketNumber}`,
      record: prepared.user,
      results,
      filings: loaded.filings,
      filingNote: loaded.note,
      skippedFilings: loaded.skipped,
    });
  }
  const markdown = renderComparison(cases, total, storePath !== "");
  writeFileSync(outPath, markdown);
  if (storePath) {
    writeFileSync(storePath, statements.length > 0 ? `${statements.join("\n")}\n` : "-- nothing to store\n");
  }
  writeFileSync(outPath.replace(/\.md$/, "") + ".json", JSON.stringify({ totalUsd: total, published: storePath !== "", cases }, null, 2));
  console.log(`SUMMARY ${JSON.stringify({ compared: cases.length, withPdfText, totalUsd: total, published: storePath !== "", out: outPath })}`);
}

function renderComparison(cases: Array<Record<string, unknown>>, total: number, published: boolean): string {
  const observedInputs = cases.flatMap((row) => (row.results as Array<Record<string, unknown>>) ?? [])
    .filter((result) => result.model === "gpt-6-astra" && typeof result.inputTokens === "number")
    .map((result) => result.inputTokens as number);
  const observedOutputs = cases.flatMap((row) => (row.results as Array<Record<string, unknown>>) ?? [])
    .filter((result) => result.model === "gpt-6-astra" && typeof result.outputTokens === "number")
    .map((result) => result.outputTokens as number);
  const avg = (values: number[]) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
  const likely = filingBacklogCost(avg(observedInputs), Math.max(avg(observedOutputs), 1));
  const ceiling = filingBacklogCost(9_500, 2_000);
  const lines = [
    "# Emergency description comparison",
    "",
    published
      ? "Published on the public case pages. Astra is stored as the page description. Sol is stored beside it and stays readable. The final model for the backlog is still not picked. No email was sent."
      : "Not published. These descriptions are not stored on Jurvio pages. The final model is not picked, and the backlog has not been run.",
    "",
    `Comparison spend: $${total.toFixed(4)}. Count this toward the $118 cap before any backlog run.`,
    "",
    `Per case this run, using average Astra tokens (${likely.inputTokens} in, ${likely.outputTokens} out): Astra $${likely.astraPerCase.toFixed(4)}, Sol $${likely.solPerCase.toFixed(4)}.`,
    `Projected ${BACKLOG_CASES} serious applications at that rate: Astra $${likely.astraTotal.toFixed(2)} of the $110 cap (${likely.astraWithinCap ? "inside" : "over"}), Sol $${likely.solTotal.toFixed(2)} of the $8 cap (${likely.solWithinCap ? "inside" : "over"}).`,
    `Ceiling if every case hits the PDF cap and 2,000 output tokens: Astra $${ceiling.astraTotal.toFixed(2)} (${ceiling.astraWithinCap ? "inside" : "over"} $110), Sol $${ceiling.solTotal.toFixed(2)} (${ceiling.solWithinCap ? "inside" : "over"} $8).`,
    "",
  ];
  cases.forEach((row, index) => {
    lines.push(`## ${index + 1}. ${row.caption} (No. ${row.docketNumber})`, "");
    lines.push(`- Kind: ${row.kind}. Status: ${row.status}. Applicant: ${row.applicant ?? "not stated"}.`);
    if (row.administration) lines.push(`- Administration: ${row.administration}.`);
    if (row.lowerCourt) lines.push(`- Lower court: ${row.lowerCourt}.`);
    lines.push(`- Page: ${row.url}`, "");
    if (row.filingNote) lines.push(`- Filing fetch: ${row.filingNote}`);
    const filings = (row.filings as FilingExcerpt[] | undefined) ?? [];
    if (filings.length) {
      lines.push("", "| Filing | Characters | Estimated tokens | Trimmed | Withheld |", "| --- | ---: | ---: | --- | --- |");
      for (const filing of filings) {
        lines.push(`| ${filing.role} | ${filing.chars} | ${filing.estimatedTokens} | ${filing.trimmed ? "yes" : "no"} | ${filing.withheld ? "yes" : "no"} |`);
      }
    } else {
      lines.push("- No filing PDF text was added.");
    }
    const skipped = (row.skippedFilings as Array<{ role: string; reason: string }> | undefined) ?? [];
    for (const skip of skipped) lines.push(`- Skipped ${skip.role}: ${skip.reason}`);
    lines.push("");
    lines.push("| Model | Input tokens | Output tokens | Cost |");
    lines.push("| --- | ---: | ---: | ---: |");
    const results = row.results as Array<Record<string, unknown>>;
    for (const result of results) {
      if (result.error) {
        lines.push(`| ${result.model} |  |  | failed |`);
      } else {
        lines.push(`| ${result.model} | ${result.inputTokens} | ${result.outputTokens} | $${Number(result.costUsd).toFixed(4)} |`);
      }
    }
    lines.push("");
    for (const result of results) {
      lines.push(`### ${result.model}`, "");
      const note = result.rejected ? "\n\nRejected by the publication filter (missing the docket number, or it matched the sealed-text check). Not for publication.\n" : "";
      lines.push(result.error ? `Call failed: ${result.error}` : `${String(result.description ?? "")}${note}`);
      lines.push("");
    }
    lines.push("### Public record sent to both models", "", String(row.record), "");
  });
  return lines.join("\n");
}

