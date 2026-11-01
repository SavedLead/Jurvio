import type { Sql } from "postgres";
import type { VerifiedSignIn } from "./sign-in";

/**
 * Runs what the visitor was doing when they asked for the link and returns
 * where to send them. Phase 1 PR 2 only redirects; following a case from the
 * signed-out "Follow this case" box is added with follows.
 */
export async function completeSignInIntent(_sql: Sql, verified: VerifiedSignIn): Promise<string> {
  return verified.redirectPath;
}
