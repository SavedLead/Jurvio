import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captionAllowsFollow, caseFollowEligible, followCase, followState, unfollowCase } from "./follows";
import { completeSignInIntent } from "./sign-in-intent";
import { createFixtures } from "./test-fixtures";

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
    const cases = await Promise.all([1, 2, 3, 4].map(() => fx.createCase()));
    for (const legalCase of cases.slice(0, 3)) expect((await followCase(sql, userId, legalCase.publicId)).status).toBe("followed");
    expect((await followCase(sql, userId, cases[0]!.publicId)).status).toBe("already_following");
    const over = await followCase(sql, userId, cases[3]!.publicId);
    expect(over.status).toBe("limit_reached");
    if (over.status !== "limit_reached") throw new Error("expected limit");
    expect(over.state).toMatchObject({ plan: "free", followCount: 3, followLimit: 3, following: false, upgrade: { plan: "plus", monthlyPriceUsd: 19, followLimit: 50 } });

    const state = await unfollowCase(sql, userId, cases[0]!.publicId);
    expect(state).toMatchObject({ following: false, followCount: 2 });
    expect((await followCase(sql, userId, cases[3]!.publicId)).status).toBe("followed");
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
});
