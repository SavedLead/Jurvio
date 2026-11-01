import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { runCaseNews } from "./run-case-news";

const databaseUrl = process.env.DATABASE_URL;
const fixture = (name: string) => readFileSync(new URL(`../infrastructure/fixtures/${name}`, import.meta.url), "utf8");

describe.skipIf(!databaseUrl)("runCaseNews", () => {
  it("links high-confidence coverage, queues medium matches and never touches sealed or restricted cases", { timeout: 240_000 }, async () => {
    const admin = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
    const name = `case_news_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const url = new URL(databaseUrl!);
    url.pathname = `/${name}`;
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const sql = postgres(url.toString(), { max: 1, onnotice: () => {} });
    try {
      execFileSync("node", ["scripts/migrate.mjs"], { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: "pipe" });
      const [court] = await sql<{ id: string }[]>`
        INSERT INTO court (public_id, provider_court_id, name, jurisdiction, verification)
        VALUES ('jc-newsca9', 'ca9', 'United States Court of Appeals for the Ninth Circuit', 'F', 'verified') RETURNING id`;
      const ids: Record<string, string> = {};
      const cases: Array<[string, string, string, "published" | "restricted"]> = [
        ["jv-newsuber", "25-228", "UBER TECHNOLOGIES, INC., ET AL. V. CITY OF SEATTLE", "published"],
        ["jv-newsmaple", "25-231", "MAPLEBEAR INC., ET AL. V. CITY OF SEATTLE", "published"],
        ["jv-newsseal", "25-900", "SEALED V. ACME WIDGETS, INC.", "published"],
        ["jv-newsrestr", "25-901", "ACME ROCKETS, INC. V. CITY OF TACOMA", "restricted"],
      ];
      for (const [publicId, docket, caption, publication] of cases) {
        const [row] = await sql<{ id: string }[]>`
          INSERT INTO legal_case (public_id, court_id, docket_number, caption, filed_on, decided_on, publication, verification)
          VALUES (${publicId}, ${court!.id}, ${docket}, ${caption}, current_date - 300, current_date - 12, ${publication}, 'verified') RETURNING id`;
        ids[publicId] = row!.id;
        await sql`
          INSERT INTO publication_decision (object_type, object_id, displayable, indexable, machine_accessible, downloadable, summary_eligible, reason_code, rule_version)
          VALUES ('legal_case', ${row!.id}, true, true, true, false, false, 'test', 'test')`;
      }
      const requested: string[] = [];
      const recentGdelt = fixture("gdelt-uber-seattle.json").replace(/"seendate": "202610(\d\d)T/g, (_m, day: string) => {
        const date = new Date(Date.now() - (25 - Number(day)) * 86_400_000);
        return `"seendate": "${date.toISOString().slice(0, 10).replaceAll("-", "")}T`;
      });
      const cns = fixture("cns-test-feed.xml").replace(/Wed, 21 Oct 2026/g, new Date(Date.now() - 2 * 86_400_000).toUTCString().slice(0, 16));
      const fetchImpl = (async (input: string | URL | Request) => {
        const target = String(input);
        requested.push(target);
        if (target.startsWith("https://api.gdeltproject.org/")) {
          // The first call gets GDELT's plain-text throttle notice; the job pauses and retries.
          if (requested.filter((seen) => seen.startsWith("https://api.gdeltproject.org/")).length === 1) {
            return new Response("Please limit requests to one every 5 seconds or contact kalev.leetaru5@gmail.com", { status: 200 });
          }
          return new Response(recentGdelt, { status: 200 });
        }
        if (target.startsWith("https://www.courthousenews.com/")) return new Response(cns, { status: 200 });
        return new Response("not found", { status: 404 });
      }) as typeof fetch;
      const options = {
        gdelt: true, rss: true, gdeltMaxRequests: 20, gdeltMaxMs: 60_000, candidateLimit: 20,
        fetchImpl, sleep: async () => {}, rssFeeds: ["https://www.courthousenews.com/feed/"],
      };
      const summaries = await runCaseNews(sql, options);
      expect(summaries.map((summary) => [summary.source, summary.ok])).toEqual([["gdelt", true], ["courthousenews_rss", true]]);
      expect(summaries[0]!.detail.throttleRetries).toBe(1);
      // Sealed and restricted cases are never sent to GDELT.
      expect(requested.filter((target) => /Acme|ACME|Tacoma/.test(decodeURIComponent(target)))).toEqual([]);

      const links = await sql<{ public_id: string; outlet: string; source: string; review_status: string; match_method: string; snippet: string | null }[]>`
        SELECT c.public_id, l.outlet, l.source, l.review_status, l.match_method, l.snippet
        FROM case_news_link l JOIN legal_case c ON c.id = l.case_id ORDER BY c.public_id, l.outlet`;
      const byOutlet = Object.fromEntries(links.filter((link) => link.public_id === "jv-newsuber").map((link) => [link.outlet, link.review_status]));
      expect(byOutlet).toEqual({
        "Reuters": "auto_published",
        "The Seattle Times": "pending_review",
        "some-aggregator.example": "pending_review",
        "Courthouse News Service": "auto_published",
      });
      const cnsLink = links.find((link) => link.source === "courthousenews_rss");
      expect(cnsLink?.snippet).toMatch(/^A Ninth Circuit panel rejected/);
      // Precision: same-issue Maplebear case gets nothing from Uber headlines; sealed/restricted get nothing.
      expect(links.filter((link) => link.public_id !== "jv-newsuber")).toEqual([]);

      const runs = await sql<{ source: string; ok: boolean; links_published: number }[]>`SELECT source, ok, links_published FROM case_news_run ORDER BY id`;
      expect(runs.map((run) => run.source)).toEqual(["gdelt", "courthousenews_rss"]);
      const [state] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM case_news_query_state`;
      expect(state!.count).toBe(2);

      // A reviewer's decision is final; re-running neither duplicates nor overrides it.
      await sql`UPDATE case_news_link SET review_status = 'rejected' WHERE outlet = 'The Seattle Times'`;
      await sql`UPDATE case_news_query_state SET next_due_at = now() - interval '1 minute'`;
      await runCaseNews(sql, options);
      const after = await sql<{ outlet: string; review_status: string }[]>`SELECT outlet, review_status FROM case_news_link WHERE case_id = ${ids["jv-newsuber"]!}`;
      expect(after).toHaveLength(4);
      expect(after.find((row) => row.outlet === "The Seattle Times")?.review_status).toBe("rejected");
    } finally {
      await sql.end();
      await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end();
    }
  });
});
