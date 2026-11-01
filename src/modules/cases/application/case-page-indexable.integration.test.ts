import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { casePageIndexable, getPublicCase } from "./get-public-case";
import { listCaseSitemapRecords } from "@/modules/discovery/application/sitemaps";

describe("casePageIndexable", () => {
  it("indexes readable opinions and flagged tier 1/2 releases only", () => {
    expect(casePageIndexable({ hasReadableOpinion: true })).toBe(true);
    expect(casePageIndexable({ hasReadableOpinion: false, tierReleaseIndexable: true })).toBe(true);
    expect(casePageIndexable({ hasReadableOpinion: false, tierReleaseIndexable: false })).toBe(false);
    expect(casePageIndexable({ hasReadableOpinion: false })).toBe(false);
    expect(casePageIndexable({ hasReadableOpinion: true, searchExcluded: true })).toBe(false);
    expect(casePageIndexable({ hasReadableOpinion: false, tierReleaseIndexable: true, searchExcluded: true })).toBe(false);
  });
});

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("getPublicCase tierReleaseIndexable", () => {
  it("is true only for an indexable publication-tiers-v1 tier1/tier2 release decision", { timeout: 240_000 }, async () => {
    const admin = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
    const name = `case_idx_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const url = new URL(databaseUrl!);
    url.pathname = `/${name}`;
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const sql = postgres(url.toString(), { max: 1, onnotice: () => {} });
    try {
      execFileSync("node", ["scripts/migrate.mjs"], { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: "pipe" });
      const [court] = await sql<{ id: string }[]>`
        INSERT INTO court (public_id, name, jurisdiction, verification) VALUES ('jc-idxtest01', 'Test District', 'FD', 'verified') RETURNING id`;
      const decisions: Array<[string, string, string, boolean]> = [
        ["jv-idxtier01", "publication-tiers-v1", "tier1_release", true],
        ["jv-idxtier02", "publication-tiers-v1", "tier2_release", true],
        ["jv-idxtier04", "publication-tiers-v1", "tier4_release", true],
        ["jv-idxnoflag", "publication-tiers-v1", "tier2_release", false],
        ["jv-idxlegacy", "federal-metadata-v1", "verified_federal_case", true],
        ["jv-idxsealed", "publication-tiers-v1", "tier1_release", true],
      ];
      for (const [publicId, rule, reason, indexable] of decisions) {
        const [row] = await sql<{ id: string }[]>`
          INSERT INTO legal_case (public_id, court_id, docket_number, caption, publication, verification)
          VALUES (${publicId}, ${court!.id}, ${publicId}, ${publicId === "jv-idxsealed" ? "In re: Sealed Case" : "Alpha v. Beta"}, 'published', 'not_verified') RETURNING id`;
        await sql`
          INSERT INTO publication_decision (object_type, object_id, displayable, indexable, machine_accessible, downloadable, summary_eligible, reason_code, rule_version)
          VALUES ('legal_case', ${row!.id}, true, ${indexable}, true, false, false, ${reason}, ${rule})`;
      }
      const flags: Record<string, boolean | undefined> = {};
      for (const [publicId] of decisions) {
        const found = await getPublicCase(sql, publicId);
        expect(found, publicId).not.toBeNull();
        flags[publicId] = found!.tierReleaseIndexable;
        expect(found!.hasReadableOpinion).toBe(false);
      }
      expect(flags).toEqual({
        "jv-idxtier01": true,
        "jv-idxtier02": true,
        "jv-idxtier04": false,
        "jv-idxnoflag": false,
        "jv-idxlegacy": false,
        "jv-idxsealed": true,
      });
      const sealed = await getPublicCase(sql, "jv-idxsealed");
      expect(sealed!.searchExcluded).toBe(true);
      expect(casePageIndexable(sealed!)).toBe(false);
      expect((await getPublicCase(sql, "jv-idxtier01"))!.searchExcluded).toBe(false);
      const sitemapPaths = (await listCaseSitemapRecords(sql, "jv-", null)).map((record) => record.path);
      expect(sitemapPaths).toContain("/case/jv-idxtier01");
      expect(sitemapPaths).not.toContain("/case/jv-idxsealed");
      // Indexable decision but no readable opinion and no tier release: the page renders noindex, so no sitemap URL.
      expect(sitemapPaths).not.toContain("/case/jv-idxlegacy");
      expect(sitemapPaths).not.toContain("/case/jv-idxtier01/documents");
    } finally {
      await sql.end();
      await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end();
    }
  });
});
