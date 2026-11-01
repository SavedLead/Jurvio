// Shared fixtures for accounts integration tests (unique ids per call; caller cleans up with cleanupFixtures).
import { randomBytes, randomUUID } from "node:crypto";
import type { Sql } from "postgres";

export interface FixtureCase { id: string; publicId: string }

export async function createFixtures(sql: Sql) {
  const tag = randomUUID().replaceAll("-", "").slice(0, 10);
  const [court] = await sql<{ id: string }[]>`
    INSERT INTO court (public_id, provider_court_id, name, jurisdiction, verification)
    VALUES (${`jc-acct${tag}`}, ${`acct${tag}`}, ${`Test District ${tag}`}, 'F', 'verified') RETURNING id`;
  const caseIds: string[] = [];
  const userIds: string[] = [];
  let counter = 0;

  async function createCase(options: { caption?: string; docketNumber?: string; displayable?: boolean; restrictedEvent?: boolean } = {}): Promise<FixtureCase> {
    counter += 1;
    const publicId = `jv-acct${tag}${counter}`;
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO legal_case (public_id, court_id, docket_number, caption, publication, verification)
      VALUES (${publicId}, ${court!.id}, ${options.docketNumber ?? `1:26-cv-${tag}${counter}`}, ${options.caption ?? `ACME ${counter} V. BETA ${tag}`}, 'published', 'verified')
      RETURNING id`;
    caseIds.push(row!.id);
    await sql`
      INSERT INTO publication_decision (object_type, object_id, displayable, indexable, machine_accessible, downloadable, summary_eligible, reason_code, rule_version)
      VALUES ('legal_case', ${row!.id}, ${options.displayable ?? true}, true, true, false, false, 'test', 'test')`;
    if (options.restrictedEvent) {
      const [provider] = await sql<{ id: string }[]>`SELECT id FROM provider ORDER BY code LIMIT 1`;
      const hex = () => randomBytes(32).toString("hex");
      const [artifact] = await sql<{ id: string }[]>`
        INSERT INTO raw_artifact (provider_id, source_uri, content_hash, object_key, media_type, retrieved_at)
        VALUES (${provider!.id}, ${`https://example.test/${publicId}`}, ${hex()}, ${`test/${publicId}.xml`}, 'application/rss+xml', now()) RETURNING id`;
      const [registry] = await sql<{ code: string }[]>`SELECT court_code AS code FROM direct_court_registry ORDER BY court_code LIMIT 1`;
      await sql`
        INSERT INTO direct_court_event (court_code, case_id, raw_artifact_id, docket_number, caption, official_filed_at, exact_docket_text,
          event_type, visitor_description, official_source_url, content_hash, deduplication_key, restricted)
        VALUES (${registry!.code}, ${row!.id}, ${artifact!.id}, ${publicId}, 'x', now(), 'SEALED DOCUMENT', 'filing', 'x', 'https://example.test/e', ${hex()}, ${hex()}, true)`;
    }
    return { id: row!.id, publicId };
  }

  async function addDocketEntry(caseId: string, description: string, options: { createdAt?: string; filedOn?: string | null; displayable?: boolean } = {}) {
    counter += 1;
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO docket_entry (public_id, case_id, provider_entry_id, entry_number, filed_on, description, created_at)
      VALUES (${`jd-acct${tag}${counter}`}, ${caseId}, ${`acct-${tag}-${counter}`}, ${String(counter)}, ${options.filedOn === undefined ? new Date().toISOString().slice(0, 10) : options.filedOn},
        ${description}, ${options.createdAt ?? new Date().toISOString()}) RETURNING id`;
    // Like the public docket page, alerts only show entries with a displayable decision.
    await sql`
      INSERT INTO publication_decision (object_type, object_id, displayable, indexable, machine_accessible, downloadable, summary_eligible, reason_code, rule_version)
      VALUES ('docket_entry', ${row!.id}, ${options.displayable ?? true}, false, false, false, false, 'test', 'test')`;
    return row!.id;
  }

  async function createUser(email = `acct-${tag}-${counter++}@example.test`, plan: string | null = null) {
    const [row] = await sql<{ id: string }[]>`INSERT INTO app_user (email, email_verified_at) VALUES (${email}, now()) RETURNING id`;
    userIds.push(row!.id);
    if (plan) await sql`INSERT INTO account_subscription (user_id, plan, status) VALUES (${row!.id}, ${plan}::account_plan, 'active')`;
    return row!.id;
  }

  async function cleanup() {
    await sql`DELETE FROM app_user WHERE id = ANY(${userIds})`;
    const artifacts = await sql<{ id: string }[]>`DELETE FROM direct_court_event WHERE case_id = ANY(${caseIds}) RETURNING raw_artifact_id AS id`;
    await sql`DELETE FROM raw_artifact WHERE id = ANY(${artifacts.map((row) => row.id)})`;
    await sql`DELETE FROM publication_decision WHERE object_id IN (SELECT id FROM docket_entry WHERE case_id = ANY(${caseIds}))`;
    await sql`DELETE FROM publication_decision WHERE object_id = ANY(${caseIds})`;
    await sql`DELETE FROM legal_case WHERE id = ANY(${caseIds})`;
    await sql`DELETE FROM court WHERE id = ${court!.id}`;
  }

  return { tag, courtId: court!.id, createCase, addDocketEntry, createUser, cleanup };
}
