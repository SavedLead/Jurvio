import type { Sql } from "postgres";
import { hashIdentifier, normalizeEmail, safeCasePublicId } from "../domain/tokens";
import { isPlanId, type PlanId } from "../domain/plans";
import { hitRateLimit } from "./rate-limit";
import { followCase, followKindsFromBits } from "./follows";
import { joinWaitlist } from "./billing";

/**
 * No-sign-in lead capture. Used while production has no email provider (and
 * as a fallback when a sign-in email fails), so a typed email is never lost.
 */
export type LeadSource = "case_follow" | "plan" | "signin";
export type LeadStatus = "joined" | "invalid" | "rate_limited";

export interface LeadInput {
  email: unknown;
  ip: string;
  source: LeadSource;
  casePublicId?: unknown;
  plan?: unknown;
  /** Follow kinds for a case_follow lead: bit 1 activity (default), bit 2 citations. */
  followKindBits?: number;
  /** Hidden form field humans never fill. A filled value is answered as success and dropped. */
  honeypot?: unknown;
}

export const LEAD_SUCCESS_MESSAGE = "You're on the list; we'll email you when alerts go live.";

export function honeypotTripped(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export async function captureLead(sql: Sql, input: LeadInput): Promise<LeadStatus> {
  const email = normalizeEmail(input.email);
  if (!email) return "invalid";
  const casePublicId = input.source === "case_follow" ? safeCasePublicId(input.casePublicId) : null;
  if (input.source === "case_follow" && !casePublicId) return "invalid";
  const plan: PlanId | null = input.source === "plan" ? (isPlanId(input.plan) ? input.plan : null) : null;
  if (input.source === "plan" && !plan) return "invalid";
  // Bots get the same answer as people, so the trap is not revealed.
  if (honeypotTripped(input.honeypot)) return "joined";

  const kindBits = typeof input.followKindBits === "number" && input.followKindBits >= 1 && input.followKindBits <= 3
    ? Math.trunc(input.followKindBits) : 1;
  const ip = input.ip || "unknown";
  const ipAllowed = await hitRateLimit(sql, "waitlist_ip", ip);
  const emailAllowed = await hitRateLimit(sql, "waitlist_email", email);
  if (!ipAllowed || !emailAllowed) return "rate_limited";

  await sql`
    INSERT INTO lead_waitlist (email, source, case_public_id, plan, ip_hash, follow_kinds)
    VALUES (${email}, ${input.source}, ${casePublicId}, ${plan}::account_plan, ${hashIdentifier("ip", ip)}, ${kindBits})
    ON CONFLICT (email, source, coalesce(case_public_id, ''), coalesce(plan, 'free'::account_plan)) DO UPDATE SET
      submissions = lead_waitlist.submissions + 1, last_seen_at = now(),
      follow_kinds = lead_waitlist.follow_kinds | EXCLUDED.follow_kinds`;
  return "joined";
}

export interface LeadConversion { followed: string[]; plans: PlanId[] }

/**
 * After a verified sign-in, turns that address's waitlisted follows into real
 * follows (within plan limits; ineligible cases are skipped) and plan interest
 * into plan_waitlist rows. Each lead is converted once.
 */
export async function convertLeads(sql: Sql, userId: string, email: string): Promise<LeadConversion> {
  const leads = await sql<{ id: string; source: LeadSource; casePublicId: string | null; plan: PlanId | null; followKindBits: number }[]>`
    SELECT id, source, case_public_id AS "casePublicId", plan::text AS plan, follow_kinds AS "followKindBits"
    FROM lead_waitlist WHERE email = ${email} AND converted_at IS NULL
    ORDER BY created_at`;
  const result: LeadConversion = { followed: [], plans: [] };
  for (const lead of leads) {
    if (lead.source === "case_follow" && lead.casePublicId) {
      const outcome = await followCase(sql, userId, lead.casePublicId, followKindsFromBits(lead.followKindBits), { merge: true }).catch(() => null);
      // Errors and the plan limit keep the lead so it converts on a later sign-in or after an upgrade.
      if (!outcome || outcome.status === "limit_reached") continue;
      if (outcome.status === "followed" || outcome.status === "already_following" || outcome.status === "updated") result.followed.push(lead.casePublicId);
    } else if (lead.source === "plan" && lead.plan && lead.plan !== "free") {
      await joinWaitlist(sql, userId, lead.plan);
      result.plans.push(lead.plan);
    }
    await sql`UPDATE lead_waitlist SET converted_at = now(), converted_user_id = ${userId} WHERE id = ${lead.id}`;
  }
  return result;
}
