import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getCourtFreshness, recordSourceWatermark, refreshCourtFreshness } from "./court-freshness";

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("court freshness refresh", () => {
  const sql = postgres(databaseUrl ?? "postgres://invalid", { max: 1, onnotice: () => undefined });
  const suffix = Math.random().toString(36).slice(2, 8);

  beforeAll(async () => {
    const [cl] = await sql<{ id: string }[]>`SELECT id FROM provider WHERE code = 'courtlistener'`;
    const [cmecf] = await sql<{ id: string }[]>`SELECT id FROM provider WHERE code = 'official_cmecf'`;
    // Same court code under two providers: counts must merge.
    const [clCourt] = await sql<{ id: string }[]>`
      INSERT INTO court (public_id, provider_id, provider_court_id, name)
      VALUES (${"crt_fr_cl_" + suffix}, ${cl!.id}, 'nysd', 'S.D.N.Y.')
      ON CONFLICT (provider_id, provider_court_id) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
    const [officialCourt] = await sql<{ id: string }[]>`
      INSERT INTO court (public_id, provider_id, provider_court_id, name)
      VALUES (${"crt_fr_of_" + suffix}, ${cmecf!.id}, 'NYSD', 'S.D.N.Y.')
      ON CONFLICT (provider_id, provider_court_id) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
    await sql`
      INSERT INTO legal_case (public_id, court_id, docket_number, caption, filed_on, publication)
      VALUES
        (${"case_fr1_" + suffix}, ${clCourt!.id}, ${"1:26-cv-1" + suffix}, 'A v. B', '2026-10-01', 'published'),
        (${"case_fr2_" + suffix}, ${clCourt!.id}, ${"1:26-cv-2" + suffix}, 'C v. D', '2026-10-20', 'draft'),
        (${"case_fr3_" + suffix}, ${officialCourt!.id}, ${"1:26-cv-3" + suffix}, 'E v. F', '2099-01-01', 'restricted')`;
  });

  afterAll(async () => {
    await sql`DELETE FROM legal_case WHERE public_id LIKE ${"case_fr%_" + suffix}`;
    await sql`DELETE FROM court_source_watermark WHERE court_code = 'nysd'`;
    await sql.end();
  });

  it("computes one merged row per tracked court from cases and watermarks", async () => {
    await recordSourceWatermark(sql, { source: "district_rss", courtCode: "nysd", ok: true, itemsFetched: 7, newEntries: 2 });
    await recordSourceWatermark(sql, { source: "courtlistener", courtCode: "nysd", ok: false, error: "429", retryAfterUntil: new Date(Date.now() + 60_000).toISOString() });
    const result = await refreshCourtFreshness(sql);
    expect(result.courts).toBeGreaterThanOrEqual(108);
    const snapshot = await getCourtFreshness(sql);
    const nysd = snapshot.rows.find((r) => r.courtCode === "nysd");
    expect(nysd).toBeDefined();
    expect(nysd!.caseCount).toBeGreaterThanOrEqual(3);
    expect(nysd!.publishedCount).toBeGreaterThanOrEqual(1);
    expect(nysd!.withheldCount).toBeGreaterThanOrEqual(1);
    // The 2099 filing date is ignored as bad data.
    expect(nysd!.newestFiledOn! < "2099-01-01").toBe(true);
    expect(nysd!.lastFeedAt).not.toBeNull();
    expect(nysd!.lastCourtListenerAt).toBeNull();
    expect(nysd!.courtListenerRetryAfter).not.toBeNull();
    expect(snapshot.rows.filter((r) => r.courtType === "appellate")).toHaveLength(13);
    expect(snapshot.rows.filter((r) => r.courtType === "district")).toHaveLength(94);
  });

  it("refreshes just the requested courts", async () => {
    const result = await refreshCourtFreshness(sql, { courtCodes: ["NYSD", "ca2"] });
    expect(result.courts).toBe(2);
  });
});
