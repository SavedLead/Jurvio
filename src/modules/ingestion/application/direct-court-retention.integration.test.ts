import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { pruneDirectCourtEvents } from "./direct-court-retention";

const databaseUrl = process.env.DATABASE_URL;
const hex = () => createHash("sha256").update(randomUUID()).digest("hex");

describe.skipIf(!databaseUrl)("district RSS retention", () => {
  it("prunes old events and alerts but keeps recent events, live alerts and every docket entry", async () => {
    const sql = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
    const tag = randomUUID().slice(0, 8);
    try {
      const [provider] = await sql<{ id: string }[]>`SELECT id FROM provider WHERE code = 'official_cmecf'`;
      const [registry] = await sql<{ court_code: string }[]>`SELECT court_code FROM direct_court_registry ORDER BY court_code LIMIT 1`;
      expect(provider?.id).toBeTruthy();
      expect(registry?.court_code).toBeTruthy();
      const courtCode = registry!.court_code;
      const [artifact] = await sql<{ id: string }[]>`
        INSERT INTO raw_artifact (provider_id, source_uri, source_record_id, content_hash, object_key, media_type, retrieved_at)
        VALUES (${provider!.id}, ${`https://example.test/${tag}`}, ${`${courtCode}:rss`}, ${hex()}, ${`test/${tag}.xml`}, 'application/rss+xml', now())
        RETURNING id`;
      const [court] = await sql<{ id: string }[]>`
        INSERT INTO court (public_id, provider_id, provider_court_id, name, jurisdiction, verification)
        VALUES (${`jc-ret${tag}`}, ${provider!.id}, ${`ret${tag}`}, ${`ret${tag}`}, 'Federal District', 'verified')
        RETURNING id`;
      const [legalCase] = await sql<{ id: string }[]>`
        INSERT INTO legal_case (public_id, court_id, docket_number, caption, verification, publication)
        VALUES (${`case-ret${tag}`}, ${court!.id}, ${`1:26-cv-${tag}`}, 'Retention v. Test', 'verified', 'draft')
        RETURNING id`;

      const event = async (label: string, ageDays: number, linked: boolean) => {
        const [row] = await sql<{ id: string }[]>`
          INSERT INTO direct_court_event (
            court_code, case_id, raw_artifact_id, docket_number, caption, official_filed_at, exact_docket_text,
            event_type, visitor_description, official_source_url, content_hash, deduplication_key,
            publication_state, first_seen_at, last_seen_at
          ) VALUES (
            ${courtCode}, ${linked ? legalCase!.id : null}, ${artifact!.id}, ${`1:26-cv-${tag}`}, 'Retention v. Test',
            now() - make_interval(days => ${ageDays}), ${`${label} ${tag}`}, 'filing', ${label}, 'https://example.test/e',
            ${hex()}, ${hex()}, ${linked ? "published" : "needs_review"},
            now() - make_interval(days => ${ageDays}), now() - make_interval(days => ${ageDays})
          ) RETURNING id`;
        return row!.id;
      };
      const alert = async (eventId: string, ageDays: number) => {
        await sql`
          INSERT INTO direct_court_alert_event (direct_event_id, case_id, public_payload, deduplication_key, created_at, available_at)
          VALUES (${eventId}, ${legalCase!.id}, ${sql.json({ tag })}, ${hex()},
            now() - make_interval(days => ${ageDays}), now() - make_interval(days => ${ageDays}))`;
      };
      const entry = async (eventLabel: string) => {
        await sql`
          INSERT INTO docket_entry (public_id, case_id, provider_id, provider_entry_id, filed_on, description, source_artifact_id)
          VALUES (${`de-${eventLabel}-${tag}`}, ${legalCase!.id}, ${provider!.id}, ${`${eventLabel}-${tag}`}, current_date, ${eventLabel}, ${artifact!.id})`;
      };

      const oldUnlinked = await event("old-unlinked", 40, false);
      const recentUnlinked = await event("recent-unlinked", 2, false);
      const oldLinkedLiveAlert = await event("old-linked-live-alert", 40, true);
      await alert(oldLinkedLiveAlert, 40);
      await entry("old-linked-live-alert");
      const ancientLinked = await event("ancient-linked", 100, true);
      await alert(ancientLinked, 100);
      await entry("ancient-linked");

      const result = await pruneDirectCourtEvents(sql, { batchSize: 1, maxBatches: 50 });
      expect(result.eventDays).toBe(30);
      expect(result.alertDays).toBe(90);
      expect(result.alertsDeleted).toBeGreaterThanOrEqual(1);
      expect(result.eventsDeleted).toBeGreaterThanOrEqual(2);

      const left = new Set((await sql<{ id: string }[]>`
        SELECT id FROM direct_court_event WHERE id IN ${sql([oldUnlinked, recentUnlinked, oldLinkedLiveAlert, ancientLinked])}
      `).map((row) => row.id));
      expect(left.has(oldUnlinked)).toBe(false);
      expect(left.has(ancientLinked)).toBe(false);
      expect(left.has(recentUnlinked)).toBe(true);
      expect(left.has(oldLinkedLiveAlert)).toBe(true);

      const alerts = await sql`SELECT 1 FROM direct_court_alert_event WHERE case_id = ${legalCase!.id}`;
      expect(alerts.length).toBe(1);
      const entries = await sql`SELECT 1 FROM docket_entry WHERE case_id = ${legalCase!.id}`;
      expect(entries.length).toBe(2);

      // A second pass has nothing left to do.
      const again = await pruneDirectCourtEvents(sql);
      expect(again.backlog).toBe(false);
    } finally {
      await sql`DELETE FROM direct_court_alert_event WHERE public_payload->>'tag' = ${tag}`;
      await sql`DELETE FROM direct_court_event WHERE exact_docket_text LIKE ${`% ${tag}`}`;
      await sql`DELETE FROM docket_entry WHERE provider_entry_id LIKE ${`%-${tag}`}`;
      await sql`DELETE FROM legal_case WHERE public_id = ${`case-ret${tag}`}`;
      await sql`DELETE FROM court WHERE public_id = ${`jc-ret${tag}`}`;
      await sql`DELETE FROM raw_artifact WHERE object_key = ${`test/${tag}.xml`}`;
      await sql.end();
    }
  });

  it("never prunes inside the feed's own window", async () => {
    const sql = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
    try {
      const result = await pruneDirectCourtEvents(sql, { eventDays: 0, alertDays: 0 });
      expect(result.eventDays).toBe(7);
      expect(result.alertDays).toBe(7);
    } finally {
      await sql.end();
    }
  });
});
