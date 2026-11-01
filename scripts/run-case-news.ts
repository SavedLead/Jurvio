import postgres from "postgres";
import { env } from "@/lib/config/env";
import { runCaseNews } from "@/modules/case-news/application/run-case-news";
import type { PriorityTier } from "@/modules/case-news/application/select-candidates";

// "In the news" ingest: finds news coverage of priority cases (SCOTUS first,
// then courts of appeals, then cited, agency and big-company cases) through the
// GDELT DOC API, Google News RSS search and Courthouse News RSS, scores each match and stores link
// metadata only. One health row per source per run in case_news_run.
//   node jobs/run-case-news.mjs [--gdelt-max-requests=90] [--gdelt-max-ms=540000]
//     [--candidates=300] [--tiers=scotus,appeals] [--no-rss] [--no-gdelt]
//     [--no-google-news] [--google-news-max-requests=30]
const args = new Map(process.argv.slice(2).map((value) => {
  const [key, raw = "true"] = value.replace(/^--/, "").split("=", 2);
  return [key, raw] as const;
}));
const int = (name: string, fallback: number) => {
  const value = Number.parseInt(args.get(name) ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
const tiers = args.get("tiers")?.split(",").map((tier) => tier.trim()).filter(Boolean) as PriorityTier[] | undefined;

const sql = postgres(env().DATABASE_URL, {
  max: 1,
  connection: { application_name: "jurvio-case-news", statement_timeout: 60_000 },
});
try {
  const [lock] = await sql<{ ok: boolean }[]>`SELECT pg_try_advisory_lock(hashtext('jurvio-case-news-v1')) AS ok`;
  if (!lock?.ok) {
    console.log(JSON.stringify({ caseNews: "skipped", reason: "previous run still active" }));
  } else {
    const started = Date.now();
    const summaries = await runCaseNews(sql, {
      gdelt: !args.has("no-gdelt"),
      rss: !args.has("no-rss"),
      googleNews: !args.has("no-google-news"),
      googleNewsMaxRequests: int("google-news-max-requests", 30),
      gdeltMaxRequests: int("gdelt-max-requests", 90),
      gdeltMaxMs: int("gdelt-max-ms", 9 * 60_000),
      candidateLimit: int("candidates", 300),
      tiers,
    });
    console.log(JSON.stringify({ caseNews: "done", elapsedMs: Date.now() - started, summaries }));
    if (summaries.length > 0 && summaries.every((summary) => !summary.ok)) process.exitCode = 1;
  }
} finally {
  await sql.end();
}
