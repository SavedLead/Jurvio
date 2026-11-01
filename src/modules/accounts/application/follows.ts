import type { Sql } from "postgres";
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

export async function caseFollowEligible(sql: Sql, casePublicId: string): Promise<boolean> {
  const [row] = await sql<{ ok: boolean }[]>`
    SELECT ${sql.unsafe(followEligibleSql("c"))} AS ok FROM legal_case c WHERE c.public_id = ${casePublicId}`;
  return Boolean(row?.ok);
}

export interface FollowState {
  eligible: boolean;
  following: boolean;
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
  const [row] = await sql<{ eligible: boolean | null; following: boolean; followCount: number }[]>`
    SELECT
      (SELECT ${sql.unsafe(followEligibleSql("c"))} FROM legal_case c WHERE c.public_id = ${casePublicId}) AS eligible,
      EXISTS (SELECT 1 FROM case_follow f JOIN legal_case c ON c.id = f.case_id WHERE f.user_id = ${userId} AND c.public_id = ${casePublicId}) AS following,
      (SELECT count(*)::int FROM case_follow WHERE user_id = ${userId}) AS "followCount"`;
  const limit = planLimits(plan).followLimit;
  return {
    eligible: Boolean(row?.eligible),
    following: Boolean(row?.following),
    plan,
    followCount: row?.followCount ?? 0,
    followLimit: limit,
    upgrade: upgradeFor(plan),
  };
}

export type FollowResult =
  | { status: "followed" | "already_following"; state: FollowState }
  | { status: "limit_reached"; state: FollowState }
  | { status: "not_eligible" };

/** Follows a case within the user's plan limit. Serialized per user so concurrent clicks cannot exceed it. */
export async function followCase(sql: Sql, userId: string, casePublicId: string): Promise<FollowResult> {
  const outcome = await sql.begin(async (tx) => {
    await tx`SELECT 1 FROM app_user WHERE id = ${userId} FOR UPDATE`;
    const [legalCase] = await tx<{ id: string; ok: boolean }[]>`
      SELECT c.id, ${tx.unsafe(followEligibleSql("c"))} AS ok FROM legal_case c WHERE c.public_id = ${casePublicId}`;
    if (!legalCase?.ok) return "not_eligible" as const;
    const [existing] = await tx`SELECT 1 FROM case_follow WHERE user_id = ${userId} AND case_id = ${legalCase.id}`;
    if (existing) return "already_following" as const;
    const plan = await userPlan(tx as unknown as Sql, userId);
    const [count] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM case_follow WHERE user_id = ${userId}`;
    if ((count?.n ?? 0) >= planLimits(plan).followLimit) return "limit_reached" as const;
    await tx`INSERT INTO case_follow (user_id, case_id) VALUES (${userId}, ${legalCase.id}) ON CONFLICT DO NOTHING`;
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
