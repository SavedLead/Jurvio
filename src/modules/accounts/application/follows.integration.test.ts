import postgres from "postgres";
import { PLANS } from "../domain/plans";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captionAllowsFollow, caseFollowEligible, followCase, followState, parseFollowKinds, unfollowCase } from "./follows";
import { completeSignInIntent } from "./sign-in-intent";
import { createFixtures } from "./test-fixtures";

const FREE_LIMIT = PLANS.free.followLimit;

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("case follows", () => {
  const sql = postgres(databaseUrl ?? "postgres://unused", { max: 1, onnotice: () => {} });
  let fx: Awaited<ReturnType<typeof createFixtures>>;
  beforeAll(async () => { fx = await createFixtures(sql); });
  afterAll(async () => { await fx?.cleanup(); await sql.end(); });

  it("never allows sealed, restricted or hidden cases", async () => {
    const open = await fx.createCase();
    const sealed = await fx.createCase({ caption: "IN RE GRAND JURY SUBPOENA" });
    const restricted = await fx.createCase({ restrictedEvent: true });
    const hidden = await fx.createCase({ displayable: false });
    const warrant = await fx.createCase({ docketNumber: "1:26-mj-00012" });
    expect(await caseFollowEligible(sql, open.publicId)).toBe(true);
    for (const legalCase of [sealed, restricted, hidden, warrant]) {
      expect(await caseFollowEligible(sql, legalCase.publicId)).toBe(false);
    }
    expect(await caseFollowEligible(sql, "jv-does-not-exist")).toBe(false);
    expect(captionAllowsFollow("United States v. Sealed Defendant", "1:26-cr-1")).toBe(false);
    expect(captionAllowsFollow("Acme v. Beta", "1:26-sw-1")).toBe(false);
    expect(captionAllowsFollow("Acme v. Beta", "1:26-cv-1")).toBe(true);
    const userId = await fx.createUser();
    expect(await followCase(sql, userId, restricted.publicId)).toEqual({ status: "not_eligible" });
    expect(await followCase(sql, userId, sealed.publicId)).toEqual({ status: "not_eligible" });
  });

  it("enforces the plan follow limit with an upgrade suggestion", async () => {
    const userId = await fx.createUser();
    const cases = await Promise.all(Array.from({ length: FREE_LIMIT + 1 }, () => fx.createCase()));
    for (const legalCase of cases.slice(0, FREE_LIMIT)) expect((await followCase(sql, userId, legalCase.publicId)).status).toBe("followed");
    expect((await followCase(sql, userId, cases[0]!.publicId)).status).toBe("already_following");
    const over = await followCase(sql, userId, cases[FREE_LIMIT]!.publicId);
    expect(over.status).toBe("limit_reached");
    if (over.status !== "limit_reached") throw new Error("expected limit");
    expect(over.state).toMatchObject({ plan: "free", followCount: FREE_LIMIT, followLimit: FREE_LIMIT, following: false, upgrade: { plan: "plus", monthlyPriceUsd: 19, followLimit: 50 } });

    const state = await unfollowCase(sql, userId, cases[0]!.publicId);
    expect(state).toMatchObject({ following: false, followCount: FREE_LIMIT - 1 });
    expect((await followCase(sql, userId, cases[FREE_LIMIT]!.publicId)).status).toBe("followed");
  });

  it("uses the paid plan's limit", async () => {
    const userId = await fx.createUser(undefined, "plus");
    const legalCase = await fx.createCase();
    expect(await followState(sql, userId, legalCase.publicId)).toMatchObject({ plan: "plus", followLimit: 50, eligible: true, following: false });
  });

  it("follows the case from a signed-out follow box once the link is opened", async () => {
    const userId = await fx.createUser();
    const legalCase = await fx.createCase();
    const destination = await completeSignInIntent(sql, {
      userId, email: "x@example.test", sessionToken: "t", redirectPath: `/case/${legalCase.publicId}`, followCasePublicId: legalCase.publicId,
    });
    expect(destination).toBe(`/case/${legalCase.publicId}?follow=followed#follow`);
    expect((await followState(sql, userId, legalCase.publicId)).following).toBe(true);
    const sealed = await fx.createCase({ caption: "UNDER SEAL V. X" });
    expect(await completeSignInIntent(sql, { userId, email: "x", sessionToken: "t", redirectPath: "/account", followCasePublicId: sealed.publicId }))
      .toBe(`/case/${sealed.publicId}`);
  });

  it("keeps activity and citation kinds per follow, one follow slot per case", async () => {
    const userId = await fx.createUser();
    const cases = await Promise.all(Array.from({ length: FREE_LIMIT + 1 }, () => fx.createCase()));
    expect((await followCase(sql, userId, cases[0]!.publicId, { activity: false, citations: true })).status).toBe("followed");
    expect(await followState(sql, userId, cases[0]!.publicId)).toMatchObject({ following: true, activity: false, citations: true, followCount: 1 });
    const both = await followCase(sql, userId, cases[0]!.publicId, { activity: true, citations: true });
    expect(both.status).toBe("updated");
    expect(await followState(sql, userId, cases[0]!.publicId)).toMatchObject({ activity: true, citations: true, followCount: 1 });
    // Merge (sign-in intent / waitlist) only switches kinds on.
    expect((await followCase(sql, userId, cases[0]!.publicId, { activity: true, citations: false }, { merge: true })).status).toBe("already_following");
    // Both off = unfollow.
    expect((await followCase(sql, userId, cases[0]!.publicId, { activity: false, citations: false })).status).toBe("updated");
    expect(await followState(sql, userId, cases[0]!.publicId)).toMatchObject({ following: false, activity: false, citations: false, followCount: 0 });
    // Citation follows count toward the same plan limit.
    for (const legalCase of cases.slice(0, FREE_LIMIT)) await followCase(sql, userId, legalCase.publicId, { activity: false, citations: true });
    expect((await followCase(sql, userId, cases[FREE_LIMIT]!.publicId, { activity: false, citations: true })).status).toBe("limit_reached");
    // Changing kinds on an existing follow is allowed at the limit.
    expect((await followCase(sql, userId, cases[1]!.publicId, { activity: true, citations: true })).status).toBe("updated");
  });

  it("parses follow kinds from forms and JSON", () => {
    expect(parseFollowKinds({})).toEqual({ activity: true, citations: false });
    expect(parseFollowKinds({ follow_kinds: "1", follow_citations: "on" })).toEqual({ activity: false, citations: true });
    expect(parseFollowKinds({ follow_kinds: "1", follow_activity: "on", follow_citations: "on" })).toEqual({ activity: true, citations: true });
    expect(parseFollowKinds({ follow_kinds: "1" })).toBeNull();
    expect(parseFollowKinds({ activity: true, citations: false })).toEqual({ activity: true, citations: false });
    expect(parseFollowKinds({ citations: true })).toEqual({ activity: false, citations: true });
    expect(parseFollowKinds({ activity: false, citations: false })).toBeNull();
  });
});
