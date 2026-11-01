import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { decideCaseNewsLink, listCaseNews, listCaseNewsReviewQueue, listRecentCaseNews } from "./list-case-news";

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("case news read path", () => {
  it("shows only visible links on eligible cases", { timeout: 240_000 }, async () => {
    const admin = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
    const name = `case_news_read_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const url = new URL(databaseUrl!);
    url.pathname = `/${name}`;
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const sql = postgres(url.toString(), { max: 1, onnotice: () => {} });
    try {
      execFileSync("node", ["scripts/migrate.mjs"], { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: "pipe" });
      const [court] = await sql<{ id: string }[]>`
        INSERT INTO court (public_id, provider_court_id, name, jurisdiction, verification) VALUES ('jc-readca2', 'ca2', 'Second Circuit', 'F', 'verified') RETURNING id`;
      const ids: Record<string, string> = {};
      for (const [publicId, caption, displayable] of [
        ["jv-readopen", "ACME CORP V. BETA LLC", true],
        ["jv-readseal", "IN RE SEALED CASE", true],
        ["jv-readhide", "GAMMA INC V. DELTA INC", false],
      ] as const) {
        const [row] = await sql<{ id: string }[]>`
          INSERT INTO legal_case (public_id, court_id, docket_number, caption, publication, verification)
          VALUES (${publicId}, ${court!.id}, ${publicId}, ${caption}, 'published', 'verified') RETURNING id`;
        ids[publicId] = row!.id;
        await sql`
          INSERT INTO publication_decision (object_type, object_id, displayable, indexable, machine_accessible, downloadable, summary_eligible, reason_code, rule_version)
          VALUES ('legal_case', ${row!.id}, ${displayable}, true, true, false, false, 'test', 'test')`;
      }
      const insert = (caseId: string, slug: string, status: string, daysAgo = 1) => sql`
        INSERT INTO case_news_link (case_id, url, outlet, outlet_domain, title, published_at, source, match_method, match_score, match_rule_version, review_status)
        VALUES (${caseId}, ${`https://www.reuters.com/${slug}`}, 'Reuters', 'reuters.com', ${`Headline ${slug}`}, now() - make_interval(days => ${daysAgo}),
          'gdelt', 'parties_court_timeframe', 0.9, 'test', ${status})`;
      await insert(ids["jv-readopen"]!, "a", "auto_published", 2);
      await insert(ids["jv-readopen"]!, "b", "approved", 1);
      await insert(ids["jv-readopen"]!, "c", "pending_review");
      await insert(ids["jv-readopen"]!, "d", "rejected");
      await insert(ids["jv-readseal"]!, "e", "auto_published");
      await insert(ids["jv-readhide"]!, "f", "auto_published");
      await insert(ids["jv-readhide"]!, "g", "pending_review");

      expect((await listCaseNews(sql, "jv-readopen")).map((link) => link.title)).toEqual(["Headline b", "Headline a"]);
      expect(await listCaseNews(sql, "jv-readseal")).toEqual([]);
      expect(await listCaseNews(sql, "jv-readhide")).toEqual([]);
      expect((await listRecentCaseNews(sql, 10)).map((link) => link.title)).toEqual(["Headline b", "Headline a"]);
      const queue = await listCaseNewsReviewQueue(sql);
      expect(queue.map((item) => item.title)).toEqual(["Headline c"]);
      expect(await decideCaseNewsLink(sql, { id: queue[0]!.id, decision: "approved", reviewer: "reviewer@jurvio.com" })).toBe(true);
      expect((await listCaseNews(sql, "jv-readopen")).map((link) => link.title)).toContain("Headline c");
    } finally {
      await sql.end();
      await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end();
    }
  });
});
