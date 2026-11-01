import type { Sql } from "postgres";
import type { VerifiedSignIn } from "./sign-in";
import { followCase, followKindsFromBits } from "./follows";
import { convertLeads } from "./waitlist";

/**
 * Runs what the visitor was doing when they asked for the link and returns
 * where to send them. From the signed-out "Follow this case" box the case is
 * followed (within plan limits; an ineligible or over-limit case is simply
 * not followed and the case page shows why). Waitlisted leads for the same
 * address are converted first.
 */
export async function completeSignInIntent(sql: Sql, verified: VerifiedSignIn): Promise<string> {
  // Follows and plan interest left on the waitlist (before email sign-in existed) become real now.
  await convertLeads(sql, verified.userId, verified.email).catch((error) => {
    console.error(JSON.stringify({ signin: "lead_conversion_failed", error: error instanceof Error ? error.message : "error" }));
  });
  if (!verified.followCasePublicId) return verified.redirectPath;
  const result = await followCase(sql, verified.userId, verified.followCasePublicId,
    followKindsFromBits(verified.followKindBits), { merge: true }).catch(() => null);
  const casePath = `/case/${verified.followCasePublicId}`;
  const base = verified.redirectPath.startsWith(casePath) ? verified.redirectPath : casePath;
  const note = result?.status === "limit_reached" ? "limit" : result && result.status !== "not_eligible" ? "followed" : null;
  return note ? `${base.split("#")[0]}${base.includes("?") ? "&" : "?"}follow=${note}#follow` : base;
}
