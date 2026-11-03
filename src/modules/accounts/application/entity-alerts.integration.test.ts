import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EmailMessage, EmailProvider } from "../infrastructure/email";
import { matchEntityAlerts, sendEntityAlerts } from "./entity-alerts";
import { followEntity, listEntityFollows, resolveEntityTarget, unfollowEntity } from "./entity-follows";
import { createFixtures } from "./test-fixtures";

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("judge, topic and party alerts", () => {
  const sql = postgres(databaseUrl ?? "postgres://unused", { max: 1, onnotice: () => {} });
  let fx: Awaited<ReturnType<typeof createFixtures>>;
  const cleanups: Array<() => Promise<unknown>> = [];
  beforeAll(async () => { fx = await createFixtures(sql); });
  afterAll(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup().catch(() => undefined);
    await fx?.cleanup();
    await sql.end();
  });

  const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  const hex = () => randomBytes(32).toString("hex");
  const decide = (type: string, id: string, displayable: boolean, reason = "test") => sql`
    INSERT INTO publication_decision (object_type, object_id, displayable, indexable, machine_accessible, downloadable, summary_eligible, reason_code, rule_version)
    VALUES (${type}, ${id}, ${displayable}, false, false, false, false, ${reason}, 'test')`;

  async function artifact() {
    const [provider] = await sql<{ id: string }[]>`SELECT id FROM provider ORDER BY code LIMIT 1`;
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO raw_artifact (provider_id, source_uri, content_hash, object_key, media_type, retrieved_at)
      VALUES (${provider!.id}, ${`https://example.test/${fx.tag}/${hex().slice(0, 8)}`}, ${hex()}, ${`test/${fx.tag}-${hex().slice(0, 8)}`}, 'application/json', now()) RETURNING id`;
    cleanups.push(() => sql`DELETE FROM raw_artifact WHERE id = ${row!.id}`);
    return row!.id;
  }

  async function setup() {
    const userId = await fx.createUser(`entity-${fx.tag}@example.test`, "pro");
    const district = await fx.createCase({ caption: `WIDGET WORKERS ${fx.tag} V. ACME WIDGETS ${fx.tag} LLC` });
    const sealed = await fx.createCase({ caption: `SEALED ${fx.tag} V. DOE` });
    await sql`UPDATE legal_case SET nature_of_suit_code = '442 Civil Rights: Employment', filed_on = current_date WHERE id IN (${district.id}, ${sealed.id})`;

    // Judge assigned to the district case.
    const source = await artifact();
    const [judge] = await sql<{ id: string; publicId: string }[]>`
      INSERT INTO judge (public_id, display_name, normalized_name, verification)
      VALUES (${`jj-t${fx.tag.slice(0, 8)}`}, ${`Judge Test ${fx.tag}`}, ${`judge test ${fx.tag}`}, 'verified') RETURNING id, public_id AS "publicId"`;
    cleanups.push(() => sql`DELETE FROM judge WHERE id = ${judge!.id}`);
    cleanups.push(() => sql`DELETE FROM publication_decision WHERE object_id = ${judge!.id}`);
    await decide("judge", judge!.id, true);
    await sql`INSERT INTO judge_case_assignment (judge_id, case_id, source_artifact_id, extraction_method, extractor_version, confidence)
      VALUES (${judge!.id}, ${district.id}, ${source}, 'source_field', 'test', 1), (${judge!.id}, ${sealed.id}, ${source}, 'source_field', 'test', 1)`;

    // Party named in the district case caption and in a Supreme Court caption.
    let [scotus] = await sql<{ id: string }[]>`SELECT id FROM court WHERE lower(provider_court_id) = 'scotus' ORDER BY created_at LIMIT 1`;
    if (!scotus) {
      [scotus] = await sql<{ id: string }[]>`INSERT INTO court (public_id, provider_court_id, name, jurisdiction, verification)
        VALUES (${`jc-sc${fx.tag.slice(0, 8)}`}, 'scotus', 'Supreme Court of the United States', 'F', 'verified') RETURNING id`;
      const id = scotus!.id;
      cleanups.push(() => sql`DELETE FROM court WHERE id = ${id}`);
    }
    const supreme = await fx.createCase({ caption: `ACME WIDGETS ${fx.tag}, LLC, Petitioner v. UNITED STATES`, docketNumber: `25-${fx.tag.slice(0, 5)}` });
    await sql`UPDATE legal_case SET court_id = ${scotus!.id}, filed_on = current_date - 3 WHERE id = ${supreme.id}`;
    cleanups.push(() => sql`DELETE FROM legal_case WHERE id = ${supreme.id}`);
    return { userId, district, sealed, supreme, judge: judge! };
  }

  it("matches new public filings to judge, topic and party follows without exposing non-public text", async () => {
    const { userId, district, sealed, supreme, judge } = await setup();
    const judgeTarget = await resolveEntityTarget(sql, "judge", judge.publicId);
    const partyTarget = await resolveEntityTarget(sql, "party", `Acme Widgets ${fx.tag} LLC, et al.`);
    const topicTarget = await resolveEntityTarget(sql, "topic", "civil-rights");
    expect(judgeTarget?.label).toBe(`Judge Test ${fx.tag}`);
    expect(partyTarget).toMatchObject({ targetKey: `acme widgets ${fx.tag.toLowerCase()} llc`, label: `Acme Widgets ${fx.tag} LLC` });
    expect(await resolveEntityTarget(sql, "party", `Nobody Named ${fx.tag} Anywhere`)).toBeNull();
    expect(await resolveEntityTarget(sql, "party", `Doe`)).toBeNull();
    expect(await resolveEntityTarget(sql, "topic", "not-a-topic")).toBeNull();
    expect(await resolveEntityTarget(sql, "judge", "jj-nosuchjudge")).toBeNull();

    expect((await followEntity(sql, userId, judgeTarget!, "asap")).status).toBe("followed");
    expect((await followEntity(sql, userId, partyTarget!, "asap")).status).toBe("followed");
    expect((await followEntity(sql, userId, topicTarget!, "daily")).status).toBe("followed");
    await sql`UPDATE entity_follow SET created_at = now() - interval '2 hours' WHERE user_id = ${userId}`;
    const followIds = (await sql<{ id: string }[]>`SELECT id FROM entity_follow WHERE user_id = ${userId}`).map((row) => row.id);

    // District entries are never displayable: alert says "New docket entry", never the text.
    const motion = await fx.addDocketEntry(district.id, `MOTION to dismiss for lack of jurisdiction ${fx.tag}`, { createdAt: ago(30), displayable: false });
    await fx.addDocketEntry(district.id, `SEALED MOTION ${fx.tag}`, { createdAt: ago(30), displayable: false });
    const hidden = await fx.addDocketEntry(district.id, `Order ${fx.tag}`, { createdAt: ago(30), displayable: false });
    await decide("docket_entry", hidden, false, "sealed_entry");
    await fx.addDocketEntry(district.id, `Old history ${fx.tag}`, { createdAt: ago(30), filedOn: "2010-01-01", displayable: false });
    await fx.addDocketEntry(sealed.id, `Complaint ${fx.tag}`, { createdAt: ago(30), displayable: false });
    // Supreme Court: displayable entries show their text; non-displayable ones are skipped.
    await fx.addDocketEntry(supreme.id, `Brief of respondent United States in opposition filed ${fx.tag}`, { createdAt: ago(20) });
    await fx.addDocketEntry(supreme.id, `Hidden SCOTUS entry ${fx.tag}`, { createdAt: ago(20), displayable: false });

    const window = { from: new Date(Date.now() - 60 * 60_000), to: new Date() };
    const dry = await matchEntityAlerts(sql, { window, followIds, dryRun: true });
    expect(dry.stored).toBeGreaterThan(0);
    expect(await sql`SELECT 1 FROM entity_alert_item WHERE follow_id = ANY(${followIds})`).toHaveLength(0);

    const run = await matchEntityAlerts(sql, { window, followIds });
    expect(run.stored).toBe(dry.stored);
    expect(run.byKind.judge).toBeGreaterThan(0);
    expect(run.byKind.topic).toBeGreaterThan(0);
    expect(run.byKind.party).toBeGreaterThan(0);

    const items = await sql<{ kind: string; itemKey: string; summary: string; caseId: string }[]>`
      SELECT f.kind, i.item_key AS "itemKey", i.summary, i.case_id AS "caseId"
      FROM entity_alert_item i JOIN entity_follow f ON f.id = i.follow_id WHERE i.follow_id = ANY(${followIds})`;
    const all = items.map((item) => item.summary).join("\n");
    expect(all).not.toMatch(/dismiss|SEALED|Old history|Hidden SCOTUS|Order /);
    expect(items.some((item) => item.caseId === sealed.id)).toBe(false);
    expect(items.filter((item) => item.kind === "judge").map((item) => item.itemKey)).toContain(`entry:${motion}`);
    expect(items.find((item) => item.itemKey === `entry:${motion}`)?.summary).toBe("New docket entry");
    expect(items.some((item) => item.kind === "party" && item.summary.startsWith("Brief of respondent United States"))).toBe(true);
    expect(items.some((item) => item.kind === "topic" && item.summary === "New case filed")).toBe(true);
    expect(items.some((item) => item.kind === "topic" && item.caseId === supreme.id)).toBe(false);

    // Same window again stores nothing new.
    expect((await matchEntityAlerts(sql, { window, followIds })).stored).toBe(0);

    const listed = await listEntityFollows(sql, userId);
    expect(listed).toHaveLength(3);
    expect(listed.find((follow) => follow.kind === "party")!.recent.length).toBeGreaterThan(0);

    // Sending: asap follows go now, the daily topic waits for its day.
    const sent: EmailMessage[] = [];
    const provider: EmailProvider = { name: "fake-entity", send: async (message) => { sent.push(message); return { ok: true, providerMessageId: "e1" }; } };
    const deps = { provider, siteUrl: "https://jurvio.com", postalAddress: "Jurvio, 1 Main St, New York, NY" };
    expect((await sendEntityAlerts(sql, { ...deps, provider: null })).status).toBe("skipped");
    await sendEntityAlerts(sql, deps);
    const mine = sent.filter((message) => message.to === `entity-${fx.tag}@example.test`);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.text).toContain("Brief of respondent United States");
    expect(mine[0]!.text).toContain("New docket entry");
    expect(mine[0]!.text).not.toMatch(/dismiss|instant(?!ly)/i);
    expect(mine[0]!.text).toContain("not instantly");
    expect(mine[0]!.text).not.toContain("Topic: Civil rights");
    const [queued] = await sql<{ topic: number; others: number }[]>`
      SELECT count(*) FILTER (WHERE f.kind = 'topic' AND i.sent_at IS NULL)::int AS topic,
        count(*) FILTER (WHERE f.kind <> 'topic' AND i.sent_at IS NULL)::int AS others
      FROM entity_alert_item i JOIN entity_follow f ON f.id = i.follow_id WHERE f.user_id = ${userId}`;
    expect(queued).toEqual({ topic: expect.any(Number), others: 0 });
    expect(queued!.topic).toBeGreaterThan(0);

    // A day later the daily digest is due.
    sent.length = 0;
    await sendEntityAlerts(sql, { ...deps, now: new Date(Date.now() + 24 * 60 * 60_000) });
    const daily = sent.filter((message) => message.to === `entity-${fx.tag}@example.test`);
    expect(daily).toHaveLength(1);
    expect(daily[0]!.text).toContain("Topic: Civil rights");

    await unfollowEntity(sql, userId, judgeTarget!);
    expect(await listEntityFollows(sql, userId)).toHaveLength(2);
  });

  it("enforces the plan's judge/topic/party limit", async () => {
    const userId = await fx.createUser(`entity-free-${fx.tag}@example.test`);
    const first = await resolveEntityTarget(sql, "topic", "contracts");
    const second = await resolveEntityTarget(sql, "topic", "antitrust");
    expect((await followEntity(sql, userId, first!, "daily")).status).toBe("followed");
    const over = await followEntity(sql, userId, second!, "daily");
    expect(over.status).toBe("limit_reached");
    expect(over.state).toMatchObject({ plan: "free", entityCount: 1, entityLimit: 1, following: false, upgrade: { plan: "plus" } });
    expect((await followEntity(sql, userId, first!, "asap")).status).toBe("updated");
  });
});
