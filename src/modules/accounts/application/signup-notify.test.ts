import { describe, expect, it } from "vitest";
import type { EmailMessage } from "../infrastructure/email";
import { maskEmail, notifySignupEvent, signupDetailsFromRow, signupNotificationEmail, signupNotifyRecipient } from "./signup-notify";

const details = {
  email: "jane.doe@gmail.com", createdAt: new Date("2026-11-05T03:22:00Z"), plan: "free", status: "active",
  attribution: { source: "google", referrerHost: "google.com", landingPath: "/case/jv-abc", utmSource: "news", utmMedium: null, utmCampaign: "launch",
    firstTouchAt: new Date("2026-11-05T03:00:00Z"), signinFromPath: "/case/jv-abc" },
  follows: ["case jv-abc: Doe v. Roe"],
};

describe("signup notification", () => {
  it("masks the local part and keeps the domain", () => {
    expect(maskEmail("jane.doe@gmail.com")).toBe("j•••e@gmail.com");
    expect(maskEmail("ab@x.org")).toBe("a•••@x.org");
  });
  it("defaults the recipient and honours SIGNUP_NOTIFY_TO", () => {
    expect(signupNotifyRecipient({})).toBe("research@jurvio.com");
    expect(signupNotifyRecipient({ SIGNUP_NOTIFY_TO: "x@y.com" })).toBe("x@y.com");
    expect(signupNotifyRecipient({ SIGNUP_NOTIFY_TO: "off" })).toBeNull();
  });
  it("includes the full address; has ET time, tier, attribution, follows, Growth link", () => {
    const m = signupNotificationEmail(details);
    expect(m.subject).toBe("New Jurvio sign-up: jane.doe@gmail.com (free)");
    expect(m.text).toContain("Account: jane.doe@gmail.com");
    expect(m.text).toContain("Nov 4, 2026, 10:22 PM ET");
    expect(m.text).toContain("Referrer: google.com");
    expect(m.text).toContain("Landing page: /case/jv-abc");
    expect(m.text).toContain("UTM (source / medium / campaign): news / - / launch");
    expect(m.text).toContain("Initial follows: case jv-abc: Doe v. Roe");
    expect(m.text).toContain("https://z.jurvio.com/signups");
  });
  it("never throws when the database or provider fails", async () => {
    const lines: string[] = [];
    const badSql = (() => { throw new Error("db down"); }) as never;
    const sent: EmailMessage[] = [];
    const provider = { name: "fake", send: async (m: EmailMessage) => { sent.push(m); return { ok: true }; } };
    await expect(notifySignupEvent(badSql, "u1", { provider, to: "r@x.com", log: (l) => lines.push(l) })).resolves.toBe(false);
    expect(lines[0]).toContain("db down");
    expect(sent).toHaveLength(0);
    await expect(notifySignupEvent(badSql, "u1", { provider: null, to: "r@x.com" })).resolves.toBe(false);
  });
});

describe("pre-existing sign-up backfill", () => {
  it("maps psql rows onto the live template", () => {
    const d = signupDetailsFromRow({ id: "u", email: "a@b.com", created_at: "2026-11-01T12:00:00Z", plan: null, status: null,
      attribution: { source: "x", referrer_host: "x.com", landing_path: "/", utm_source: null, utm_medium: null, utm_campaign: null, first_touch_at: null, signin_from_path: null },
      follows: null });
    const m = signupNotificationEmail(d);
    expect(m.subject).toBe("New Jurvio sign-up: a@b.com (free)");
    expect(m.text).toContain("Referrer: x.com");
  });
});
