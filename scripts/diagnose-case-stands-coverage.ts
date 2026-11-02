/**
 * Read-only coverage estimate for the "Where this case stands" summary.
 * Reads JSON lines (one sampled published case each, produced by
 * .github/workflows/diagnose-case-stands-coverage-once.yml) and runs the same
 * buildCaseStanding() the case page uses. Prints counts per court kind.
 *
 *   tsx scripts/diagnose-case-stands-coverage.ts sample.jsonl <sampleRatio>
 */
import { readFileSync } from "node:fs";
import { buildCaseStanding, readOverruledParenthetical, type FjcOutcomeSignal, type ScotusDocketSignal } from "@/modules/plain-english/domain/case-standing";
import { FJC_IDB_URL } from "@/modules/plain-english/domain/fjc-outcome";
import type { QuestionsPresented } from "@/modules/plain-english/domain/relief";
import { courtKindFromJurisdiction } from "@/modules/cases/domain/record-answers";

interface Row {
  tier: string | null; jurisdiction: string | null; courtName: string; courtCode: string | null; caption: string;
  decidedOn: string | null; filedOn: string | null; terminatedOn: string | null; dispositionScope: string | null;
  verification: string | null; exactDisposition: string | null; exactHolding: string | null; lowerCourtName: string | null;
  clusterDisposition: string | null; precedentialStatus: string | null; votesMajority: string | null; votesMinority: string | null;
  opinionTail: string | null; opinionHead?: string | null; overruled: string[] | null;
  scotusDocket?: ScotusDocketSignal | null; fjcOutcome?: FjcOutcomeSignal | null; docket: Array<{ entryNumber?: number | string | null; filedOn: string | null; description: string }> | null;
  questionsPresented?: QuestionsPresented | null;
}

const [file, ratioArg] = process.argv.slice(2);
if (!file) throw new Error("usage: diagnose-case-stands-coverage.ts <jsonl> <sampleRatio>");
const ratio = Number(ratioArg ?? "1") || 1;
type Bucket = Record<string, number>;
const byKind = new Map<string, Bucket>();
const examples = new Map<string, string>();
let total = 0;
const sources = new Map<string, number>();
function countSource(kind: string, name: string) { sources.set(`${kind} ${name}`, (sources.get(`${kind} ${name}`) ?? 0) + 1); }
for (const line of readFileSync(file, "utf8").split("\n")) {
  if (!line.trim().startsWith("{")) continue;
  const row = JSON.parse(line) as Row;
  total += 1;
  const courtKind = courtKindFromJurisdiction(row.jurisdiction, row.courtName, row.courtCode);
  const majority = Number(row.votesMajority);
  const minority = Number(row.votesMinority ?? 0);
  const votes = Number.isInteger(majority) && majority >= 1 && majority <= 9 && Number.isInteger(minority) && minority <= majority && majority + minority <= 9 ? { majority, minority } : null;
  const overruledText = (row.overruled ?? []).map((text) => readOverruledParenthetical(text)).find(Boolean) ?? null;
  const standing = buildCaseStanding({
    courtKind, courtName: row.courtName, caption: row.caption, decidedOn: row.decidedOn, filedOn: row.filedOn,
    terminatedOn: row.terminatedOn, dispositionScope: row.dispositionScope, verified: row.verification === "verified",
    exactDisposition: row.exactDisposition, dispositionSourceUrl: null, exactHolding: row.exactHolding, holdingSourceUrl: null,
    lowerCourtName: row.lowerCourtName, clusterDisposition: row.clusterDisposition, precedentialStatus: row.precedentialStatus,
    opinionTail: row.opinionTail, opinionHead: row.opinionHead ?? null, opinionPath: row.opinionTail ? "/x" : null, opinionIsMajority: Boolean(row.opinionTail),
    overruled: overruledText ? { text: overruledText, citingCaption: null, citingPath: null } : null,
    votes, citedByCount: 0, docketEntries: row.docket ?? [], docketPath: "/x",
    scotusDocket: row.scotusDocket ?? null, fjcOutcome: row.fjcOutcome ?? null, questionsPresented: row.questionsPresented ?? null,
  });
  // outcome = a quoted judgment/docket outcome (who won / what was decided);
  // status-only = shown, but only says decided/closed/open without the outcome; hidden = section not rendered.
  const hasQuote = standing?.points.some((point) => (point.quote && point.id !== "good-law" && point.id !== "rule") || point.sourceHref === FJC_IDB_URL);
  if (standing?.points.some((point) => point.sourceHref === FJC_IDB_URL)) countSource(courtKind, "fjc");
  if (row.scotusDocket && standing?.points.some((point) => point.sourceHref === row.scotusDocket?.sourceUrl)) countSource(courtKind, `docket-${row.scotusDocket.certStatus}${row.scotusDocket.judgmentEntry ? "+judgment" : ""}`);
  // Phase 6: what each side asked for, by where the request came from.
  const asked = standing?.points.find((point) => point.id === "asked");
  if (asked) {
    const from = asked.quotes?.some((quote) => /supremecourt\.gov\/qp\//.test(quote.sourceHref ?? "")) ? "questions-presented"
      : asked.quotes?.some((quote) => /^What was asked/.test(quote.sourceLabel)) ? "opinion-request"
      : asked.quotes?.some((quote) => /^The request, from the court's docket/.test(quote.sourceLabel)) ? "docket-motions"
      : asked.items?.length ? "point-rulings-only"
      : /don't (?:show|say|spell out)|don't have the petition/.test(asked.text) ? "not-in-record" : "role-only";
    countSource(courtKind, `asked-${from}`);
  }
  const closed = standing?.points.some((point) => point.id === "status" && /^No\. The court closed/.test(point.text));
  const category = !standing ? "hidden" : hasQuote ? "outcome" : closed ? "closed-only" : "status-only";
  const key = `${courtKind}${row.tier ? ` t${row.tier}` : " t-none"}`;
  const bucket = byKind.get(key) ?? {};
  bucket[category] = (bucket[category] ?? 0) + 1;
  bucket.total = (bucket.total ?? 0) + 1;
  if (standing?.points.some((point) => point.id === "good-law" && point.quote)) bucket.overruled = (bucket.overruled ?? 0) + 1;
  byKind.set(key, bucket);
  const exampleKey = `${key} ${category}`;
  if (!examples.has(exampleKey) && standing) examples.set(exampleKey, `${standing.headline} | ${standing.points.map((point) => `${point.id}: ${point.quote ?? point.text}`.slice(0, 160)).join(" | ")}`);
}
const scale = (value: number | undefined) => Math.round((value ?? 0) / ratio).toLocaleString("en-US");
console.log(`sampled cases: ${total} (ratio ${ratio}); estimates = sample / ratio`);
console.log("kind+tier | sampled | outcome | closed-only | status-only | hidden | overruled-quote || est total | est outcome | est closed-only | est status-only | est hidden");
const all: Bucket = {};
for (const [key, bucket] of [...byKind.entries()].sort()) {
  for (const [name, value] of Object.entries(bucket)) all[name] = (all[name] ?? 0) + value;
  console.log(`${key} | ${bucket.total ?? 0} | ${bucket.outcome ?? 0} | ${bucket["closed-only"] ?? 0} | ${bucket["status-only"] ?? 0} | ${bucket.hidden ?? 0} | ${bucket.overruled ?? 0} || ${scale(bucket.total)} | ${scale(bucket.outcome)} | ${scale(bucket["closed-only"])} | ${scale(bucket["status-only"])} | ${scale(bucket.hidden)}`);
}
console.log(`ALL | ${all.total ?? 0} | ${all.outcome ?? 0} | ${all["closed-only"] ?? 0} | ${all["status-only"] ?? 0} | ${all.hidden ?? 0} | ${all.overruled ?? 0} || ${scale(all.total)} | ${scale(all.outcome)} | ${scale(all["closed-only"])} | ${scale(all["status-only"])} | ${scale(all.hidden)}`);
console.log("--- summaries using an official outcome source (sampled) ---");
for (const [key, value] of [...sources.entries()].sort()) console.log(`${key}: ${value} (est ${scale(value)})`);
console.log("--- one example per bucket ---");
for (const [key, text] of [...examples.entries()].sort()) console.log(`${key}: ${text}`);
