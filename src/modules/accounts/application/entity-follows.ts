import type { Sql } from "postgres";
import { latestPublicationColumnSql } from "@/modules/publication/application/current-visibility";
import { nextPlanUp, planLimits, type PlanId } from "../domain/plans";
import { topicBySlug } from "../domain/topics";
import { cleanPartyName, isFollowablePartyName, partyKey } from "../domain/party-names";
import { followEligibleSql } from "./follows";
import type { EntityFrequency, EntityKind } from "../domain/entity-follow";
import { isPublicId } from "@/lib/ids/public-id";
import { userPlan } from "./account";

// Judge, topic and party follows. A follow stores a stable target key:
// judge public id, topic slug, or the party's normalized name (see
// domain/party-names; matched against public case captions). Targets are
// resolved and checked server-side.

export interface EntityTarget { kind: EntityKind; targetKey: string; label: string }

/** Judges shown publicly (same rule as the judge pages). */
const displayableJudge = `
  judge.verification = 'verified'
  AND COALESCE((
    SELECT decision.displayable FROM publication_decision decision
    WHERE decision.object_type = 'judge' AND decision.object_id = judge.id
    ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
  ), false)`;

/**
 * Resolves what the browser sent (judge public id, topic slug, party name or
 * party record public id) to a follow target, or null when it is not public.
 */
export async function resolveEntityTarget(sql: Sql, kind: EntityKind, raw: unknown): Promise<EntityTarget | null> {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (kind === "topic") {
    const topic = topicBySlug(value);
    return topic ? { kind, targetKey: topic.slug, label: topic.label } : null;
  }
  if (kind === "judge") {
    if (!isPublicId("judge", value)) return null;
    const [judge] = await sql<{ publicId: string; name: string }[]>`
      SELECT judge.public_id AS "publicId", judge.display_name AS name FROM judge
      WHERE judge.public_id = ${value} AND ${sql.unsafe(displayableJudge)}`;
    return judge ? { kind, targetKey: judge.publicId, label: judge.name } : null;
  }
  return resolvePartyTarget(sql, value);
}

/**
 * Party: a name (or a party record's public id) that a public, followable
 * case caption or party list names. Anonymised names (Doe, Sealed, minors…)
 * are refused. The follow key is the normalized name.
 */
async function resolvePartyTarget(sql: Sql, value: string): Promise<EntityTarget | null> {
  let name = value;
  if (isPublicId("entity", value)) {
    const [entity] = await sql<{ name: string }[]>`
      SELECT entity.display_name AS name FROM entity
      WHERE entity.public_id = ${value}
        AND ${sql.unsafe(latestPublicationColumnSql("displayable", "entity", "entity.id", true))}`;
    if (!entity) return null;
    name = entity.name;
  }
  name = cleanPartyName(name);
  if (!isFollowablePartyName(name)) return null;
  const key = partyKey(name);
  // Trigram-indexed prefilter on the longest word, then the exact whole-word
  // test (keys hold only letters, digits and single spaces, so no LIKE escapes).
  const longest = key.split(" ").sort((a, b) => b.length - a.length)[0] ?? key;
  const [found] = await sql<{ ok: boolean }[]>`
    SELECT true AS ok FROM legal_case c
    WHERE c.publication = 'published' AND c.caption ILIKE ${`%${longest}%`}
      AND (' ' || btrim(regexp_replace(lower(c.caption), '[^[:alnum:]]+', ' ', 'g')) || ' ') LIKE ${`% ${key} %`}
      AND ${sql.unsafe(followEligibleSql("c"))}
    LIMIT 1`;
  return found ? { kind: "party", targetKey: key, label: name } : null;
}

export interface EntityFollowState {
  following: boolean;
  frequency: EntityFrequency | null;
  plan: PlanId;
  entityCount: number;
  entityLimit: number;
  asapAllowed: boolean;
  upgrade: { plan: PlanId; name: string; monthlyPriceUsd: number; entityFollowLimit: number } | null;
}

function upgradeFor(plan: PlanId) {
  const next = nextPlanUp(plan, "entityFollowLimit");
  return next ? { plan: next.id, name: next.name, monthlyPriceUsd: next.monthlyPriceUsd, entityFollowLimit: next.entityFollowLimit } : null;
}

export async function entityFollowState(sql: Sql, userId: string, target: Pick<EntityTarget, "kind" | "targetKey">): Promise<EntityFollowState> {
  const plan = await userPlan(sql, userId);
  const [row] = await sql<{ frequency: EntityFrequency | null; entityCount: number }[]>`
    SELECT
      (SELECT frequency FROM entity_follow WHERE user_id = ${userId} AND kind = ${target.kind} AND target_key = ${target.targetKey}) AS frequency,
      (SELECT count(*)::int FROM entity_follow WHERE user_id = ${userId}) AS "entityCount"`;
  const limits = planLimits(plan);
  return {
    following: Boolean(row?.frequency),
    frequency: row?.frequency ?? null,
    plan,
    entityCount: row?.entityCount ?? 0,
    entityLimit: limits.entityFollowLimit,
    asapAllowed: limits.entityAsap,
    upgrade: upgradeFor(plan),
  };
}

export type EntityFollowResult =
  | { status: "followed" | "already_following" | "updated"; state: EntityFollowState }
  | { status: "limit_reached"; state: EntityFollowState };

/** Follows within the plan's judge/topic/party limit. Serialized per user (row lock) so double clicks cannot exceed it. */
export async function followEntity(sql: Sql, userId: string, target: EntityTarget, frequency: EntityFrequency = "daily"): Promise<EntityFollowResult> {
  const outcome = await sql.begin(async (tx) => {
    const db = tx as unknown as Sql;
    await db`SELECT 1 FROM app_user WHERE id = ${userId} FOR UPDATE`;
    const plan = await userPlan(db, userId);
    const limits = planLimits(plan);
    const wanted: EntityFrequency = frequency === "asap" && !limits.entityAsap ? "daily" : frequency;
    const [existing] = await db<{ frequency: string }[]>`
      SELECT frequency FROM entity_follow WHERE user_id = ${userId} AND kind = ${target.kind} AND target_key = ${target.targetKey}`;
    if (existing) {
      if (existing.frequency === wanted) return "already_following" as const;
      await db`UPDATE entity_follow SET frequency = ${wanted}, updated_at = now()
        WHERE user_id = ${userId} AND kind = ${target.kind} AND target_key = ${target.targetKey}`;
      return "updated" as const;
    }
    const [count] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM entity_follow WHERE user_id = ${userId}`;
    if ((count?.n ?? 0) >= limits.entityFollowLimit) return "limit_reached" as const;
    await db`
      INSERT INTO entity_follow (user_id, kind, target_key, label, frequency)
      VALUES (${userId}, ${target.kind}, ${target.targetKey}, ${target.label}, ${wanted})
      ON CONFLICT (user_id, kind, target_key) DO NOTHING`;
    return "followed" as const;
  });
  return { status: outcome, state: await entityFollowState(sql, userId, target) } as EntityFollowResult;
}

export async function unfollowEntity(sql: Sql, userId: string, target: Pick<EntityTarget, "kind" | "targetKey">): Promise<EntityFollowState> {
  await sql`DELETE FROM entity_follow WHERE user_id = ${userId} AND kind = ${target.kind} AND target_key = ${target.targetKey}`;
  return entityFollowState(sql, userId, target);
}

/** My alerts page: change or remove a follow by its id (scoped to the user). */
export async function updateEntityFollowById(sql: Sql, userId: string, followId: string, change: { frequency?: EntityFrequency; remove?: boolean }): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/.test(followId)) return false;
  if (change.remove) {
    const rows = await sql`DELETE FROM entity_follow WHERE id = ${followId} AND user_id = ${userId} RETURNING id`;
    return rows.length > 0;
  }
  if (!change.frequency) return false;
  const limits = planLimits(await userPlan(sql, userId));
  const frequency = change.frequency === "asap" && !limits.entityAsap ? "daily" : change.frequency;
  const rows = await sql`UPDATE entity_follow SET frequency = ${frequency}, updated_at = now() WHERE id = ${followId} AND user_id = ${userId} RETURNING id`;
  return rows.length > 0;
}

export interface EntityFollowSummary {
  id: string;
  kind: EntityKind;
  targetKey: string;
  label: string;
  frequency: EntityFrequency;
  createdAt: string;
  lastSentAt: string | null;
  queued: number;
  matches7d: number;
  recent: Array<{ casePublicId: string; caption: string; courtName: string | null; docketNumber: string; eventKind: string; occurredOn: string | null; summary: string; foundAt: string; sent: boolean }>;
}

/** Follows with their latest matches (only items the match job stored; nothing non-public). */
export async function listEntityFollows(sql: Sql, userId: string): Promise<EntityFollowSummary[]> {
  const follows = await sql<Omit<EntityFollowSummary, "recent">[]>`
    SELECT f.id, f.kind, f.target_key AS "targetKey", f.label, f.frequency, f.created_at::text AS "createdAt",
      f.last_sent_at::text AS "lastSentAt",
      (SELECT count(*)::int FROM entity_alert_item i WHERE i.follow_id = f.id AND i.sent_at IS NULL) AS queued,
      (SELECT count(*)::int FROM entity_alert_item i WHERE i.follow_id = f.id AND i.found_at > now() - interval '7 days') AS "matches7d"
    FROM entity_follow f WHERE f.user_id = ${userId}
    ORDER BY f.created_at DESC LIMIT 500`;
  if (!follows.length) return [];
  const items = await sql<Array<EntityFollowSummary["recent"][number] & { followId: string }>>`
    SELECT ranked.* FROM (
      SELECT i.follow_id AS "followId", c.public_id AS "casePublicId", c.caption, court.name AS "courtName",
        c.docket_number AS "docketNumber", i.event_kind AS "eventKind", i.occurred_on::text AS "occurredOn",
        i.summary, i.found_at::text AS "foundAt", i.sent_at IS NOT NULL AS sent,
        row_number() OVER (PARTITION BY i.follow_id ORDER BY i.found_at DESC, i.item_key) AS rn
      FROM entity_alert_item i
      JOIN entity_follow f ON f.id = i.follow_id
      JOIN legal_case c ON c.id = i.case_id
      LEFT JOIN court ON court.id = c.court_id
      WHERE f.user_id = ${userId}
        AND c.publication = 'published'
        AND ${sql.unsafe(latestPublicationColumnSql("displayable", "legal_case", "c.id"))}
    ) ranked WHERE ranked.rn <= 5`;
  return follows.map((follow) => ({
    ...follow,
    recent: items.filter((item) => item.followId === follow.id).map((item) => ({
      casePublicId: item.casePublicId, caption: item.caption, courtName: item.courtName, docketNumber: item.docketNumber,
      eventKind: item.eventKind, occurredOn: item.occurredOn, summary: item.summary, foundAt: item.foundAt, sent: item.sent,
    })),
  }));
}
