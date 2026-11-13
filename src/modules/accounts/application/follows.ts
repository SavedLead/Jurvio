import type { Sql } from "postgres";
import { queueFollowedCase } from "@/modules/ingestion/application/followed-item-priority";
import { latestPublicationColumnSql } from "@/modules/publication/application/current-visibility";
import { nextPlanUp, planLimits, type PlanId } from "../domain/plans";
import { userPlan } from "./account";

const SEALED_CAPTION = /\b(sealed|under seal|grand jury|juvenile|minor child|in re search|search warrant)\b/i;
const SEALED_DOCKET = /-(mj|gj|sw|sealed)-/i;

/** In-memory pre-check used by the case page (no query). The SQL rule below is authoritative. */
export function captionAllowsFollow(caption: string, docketNumber: string): boolean {
  return !SEALED_CAPTION.test(caption) && !SEALED_DOCKET.test(docketNumber);
}

/**
 * A case may be followed only while it is published, displayable, not sealed
 * or restricted (caption/docket signals or any restricted court event).
 * Applied when following and again when alerts are built.
 */
export function followEligibleSql(alias = "c"): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(alias)) throw new Error("invalid alias");
  return `(
    ${alias}.publication = 'published'
    AND ${latestPublicationColumnSql("displayable", "legal_case", `${alias}.id`)}
    AND ${alias}.caption !~* '\\m(sealed|under seal|grand jury|juvenile|minor child|in re search|search warrant)\\M'
    AND ${alias}.docket_number !~* '-(mj|gj|sw|sealed)-'
    AND NOT EXISTS (SELECT 1 FROM direct_court_event restricted_event
      WHERE restricted_event.case_id = ${alias}.id AND restricted_event.restricted)
  )`;
}

/**
 * A Supreme Court emergency application (not a routine extension request) can
 * be followed and alerted on while its Jurvio case is still a draft: its
 * docket lines come from the Court's public docket and already passed the
 * strict sealed/restricted filter. Every other check of followEligibleSql
 * still applies, and an explicit "not displayable" decision still hides it.
 * Only current (live-lane) applications count: a history backfill row never
 * makes a draft case followable.
 */
export function emergencyApplicationEligibleSql(alias = "c"): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(alias)) throw new Error("invalid alias");
  return `(
    ${alias}.publication IN ('published', 'draft')
    AND EXISTS (SELECT 1 FROM scotus_application emergency_app
      WHERE emergency_app.case_id = ${alias}.id AND emergency_app.kind <> 'extension' AND emergency_app.source_lane = 'live')
    AND ${latestPublicationColumnSql("displayable", "legal_case", `${alias}.id`, true)}
    AND ${alias}.caption !~* '\\m(sealed|under seal|grand jury|juvenile|minor child|in re search|search warrant)\\M'
    AND ${alias}.docket_number !~* '-(mj|gj|sw|sealed)-'
    AND NOT EXISTS (SELECT 1 FROM direct_court_event restricted_event
      WHERE restricted_event.case_id = ${alias}.id AND restricted_event.restricted)
  )`;
}

/** Cases a user may follow and get alerts for: published cases, plus held emergency applications. */
export function alertEligibleSql(alias = "c"): string {
  return `(${followEligibleSql(alias)} OR ${emergencyApplicationEligibleSql(alias)})`;
}

export async function caseFollowEligible(sql: Sql, casePublicId: string): Promise<boolean> {
  const [row] = await sql<{ ok: boolean }[]>`
    SELECT ${sql.unsafe(followEligibleSql("c"))} AS ok FROM legal_case c WHERE c.public_id = ${casePublicId}`;
  return Boolean(row?.ok);
}

/** What a follow alerts on: new docket entries, new citing opinions, or both. */
export interface FollowKinds { activity: boolean; citations: boolean }

export const DEFAULT_FOLLOW_KINDS: FollowKinds = { activity: true, citations: false };

/** bit 1 = activity, bit 2 = citations (auth_login_token / lead_waitlist.follow_kinds). */
export function followKindsToBits(kinds: FollowKinds): number {
  return (kinds.activity ? 1 : 0) | (kinds.citations ? 2 : 0);
}

export function followKindsFromBits(bits: number | null | undefined): FollowKinds {
  const value = typeof bits === "number" && bits >= 1 && bits <= 3 ? bits : 1;
  return { activity: (value & 1) === 1, citations: (value & 2) === 2 };
}

const truthy = (value: unknown) => value === true || value === "on" || value === "true" || value === "1" || value === 1;

/**
 * Kinds from a JSON body or form post (checkboxes `follow_activity` /
 * `follow_citations`, or `activity` / `citations`). Neither present = default
 * (activity only); both explicitly off = null (nothing to follow).
 */
export function parseFollowKinds(body: Record<string, unknown>): FollowKinds | null {
  const has = (name: string) => Object.prototype.hasOwnProperty.call(body, name);
  const activityKey = has("follow_activity") ? "follow_activity" : has("activity") ? "activity" : null;
  const citationsKey = has("follow_citations") ? "follow_citations" : has("citations") ? "citations" : null;
  // A form with a `follow_kinds` marker posts unticked checkboxes as absent.
  const formMarker = has("follow_kinds");
  if (!activityKey && !citationsKey && !formMarker) return { ...DEFAULT_FOLLOW_KINDS };
  const kinds = {
    activity: activityKey ? truthy(body[activityKey]) : false,
    citations: citationsKey ? truthy(body[citationsKey]) : false,
  };
  if (!formMarker && !activityKey) kinds.activity = false;
  return kinds.activity || kinds.citations ? kinds : null;
}

export interface FollowState {
  eligible: boolean;
  following: boolean;
  /** Kinds of the current follow (both false when not following). */
  activity: boolean;
  citations: boolean;
  plan: PlanId;
  followCount: number;
  followLimit: number;
  upgrade: { plan: PlanId; name: string; monthlyPriceUsd: number; followLimit: number } | null;
}

function upgradeFor(plan: PlanId) {
  const next = nextPlanUp(plan);
  return next ? { plan: next.id, name: next.name, monthlyPriceUsd: next.monthlyPriceUsd, followLimit: next.followLimit } : null;
}

export async function followState(sql: Sql, userId: string, casePublicId: string): Promise<FollowState> {
  const plan = await userPlan(sql, userId);
  const [row] = await sql<{ eligible: boolean | null; activity: boolean | null; citations: boolean | null; followCount: number }[]>`
    SELECT
      (SELECT ${sql.unsafe(alertEligibleSql("c"))} FROM legal_case c WHERE c.public_id = ${casePublicId}) AS eligible,
      mine.activity, mine.citations,
      (SELECT count(*)::int FROM case_follow WHERE user_id = ${userId}) AS "followCount"
    FROM (SELECT 1) one
    LEFT JOIN LATERAL (
      SELECT f.activity, f.citations FROM case_follow f JOIN legal_case c ON c.id = f.case_id
      WHERE f.user_id = ${userId} AND c.public_id = ${casePublicId}) mine ON true`;
  const limit = planLimits(plan).followLimit;
  return {
    eligible: Boolean(row?.eligible),
    following: row?.activity != null,
    activity: Boolean(row?.activity),
    citations: Boolean(row?.citations),
    plan,
    followCount: row?.followCount ?? 0,
    followLimit: limit,
    upgrade: upgradeFor(plan),
  };
}

export type FollowResult =
  | { status: "followed" | "already_following" | "updated"; state: FollowState }
  | { status: "limit_reached"; state: FollowState }
  | { status: "not_eligible" };

/**
 * Follows a case within the user's plan limit. Serialized per user so
 * concurrent clicks cannot exceed it. `kinds` set the follow's kinds; on an
 * existing follow they replace its kinds ("updated") unless `merge` is set,
 * which only turns kinds on (sign-in intents and waitlist conversion).
 */
export async function followCase(
  sql: Sql, userId: string, casePublicId: string,
  kinds: FollowKinds = DEFAULT_FOLLOW_KINDS, options: { merge?: boolean } = {},
): Promise<FollowResult> {
  if (!kinds.activity && !kinds.citations) return unfollowCase(sql, userId, casePublicId).then((state) => ({ status: "updated" as const, state }));
  const outcome = await sql.begin(async (tx) => {
    await tx`SELECT 1 FROM app_user WHERE id = ${userId} FOR UPDATE`;
    const [legalCase] = await tx<{ id: string; ok: boolean }[]>`
      SELECT c.id, ${tx.unsafe(alertEligibleSql("c"))} AS ok FROM legal_case c WHERE c.public_id = ${casePublicId}`;
    if (!legalCase?.ok) return "not_eligible" as const;
    const [existing] = await tx<{ activity: boolean; citations: boolean }[]>`
      SELECT activity, citations FROM case_follow WHERE user_id = ${userId} AND case_id = ${legalCase.id}`;
    if (existing) {
      const next = options.merge
        ? { activity: existing.activity || kinds.activity, citations: existing.citations || kinds.citations }
        : kinds;
      if (next.activity === existing.activity && next.citations === existing.citations) return "already_following" as const;
      // A kind switched on starts from now: no history for the new kind.
      await tx`
        UPDATE case_follow SET activity = ${next.activity}, citations = ${next.citations},
          last_alerted_entry_created_at = CASE WHEN ${next.activity} AND NOT activity THEN now() ELSE last_alerted_entry_created_at END,
          last_alerted_citation_at = CASE WHEN ${next.citations} AND NOT citations THEN now() ELSE last_alerted_citation_at END
        WHERE user_id = ${userId} AND case_id = ${legalCase.id}`;
      return "updated" as const;
    }
    const plan = await userPlan(tx as unknown as Sql, userId);
    const [count] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM case_follow WHERE user_id = ${userId}`;
    if ((count?.n ?? 0) >= planLimits(plan).followLimit) return "limit_reached" as const;
    await tx`
      INSERT INTO case_follow (user_id, case_id, activity, citations)
      VALUES (${userId}, ${legalCase.id}, ${kinds.activity}, ${kinds.citations}) ON CONFLICT DO NOTHING`;
    await queueFollowedCase(tx as unknown as Sql, legalCase.id);
    return "followed" as const;
  });
  if (outcome === "not_eligible") return { status: outcome };
  return { status: outcome, state: await followState(sql, userId, casePublicId) };
}

export async function unfollowCase(sql: Sql, userId: string, casePublicId: string): Promise<FollowState> {
  await sql`
    DELETE FROM case_follow f USING legal_case c
    WHERE f.case_id = c.id AND f.user_id = ${userId} AND c.public_id = ${casePublicId}`;
  return followState(sql, userId, casePublicId);
}
