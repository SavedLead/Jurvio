import type { Sql } from "postgres";
import type { VerifiedSignIn } from "./sign-in";
import { followCase } from "./follows";

/**
 * Runs what the visitor was doing when they asked for the link and returns
 * where to send them. From the signed-out "Follow this case" box the case is
 * followed (within plan limits; an ineligible or over-limit case is simply
 * not followed and the case page shows why).
 */
export async function completeSignInIntent(sql: Sql, verified: VerifiedSignIn): Promise<string> {
  if (!verified.followCasePublicId) return verified.redirectPath;
  const result = await followCase(sql, verified.userId, verified.followCasePublicId).catch(() => null);
  const casePath = `/case/${verified.followCasePublicId}`;
  const base = verified.redirectPath.startsWith(casePath) ? verified.redirectPath : casePath;
  const note = result?.status === "limit_reached" ? "limit" : result && result.status !== "not_eligible" ? "followed" : null;
  return note ? `${base.split("#")[0]}${base.includes("?") ? "&" : "?"}follow=${note}#follow` : base;
}
