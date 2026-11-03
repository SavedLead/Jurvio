import { describe, expect, it } from "vitest";
import { buildEntityDigestEmail, entityFollowDue, type EntityDigestItem } from "./entity-alerts";
import { FREQUENCY_LABEL, KIND_EXPLAINER, TIMING_NOTE } from "../domain/entity-follow";
import { PLANS } from "../domain/plans";

const item = (overrides: Partial<EntityDigestItem> = {}): EntityDigestItem => ({
  followId: "f1", kind: "judge", label: "Hon. Jane Roe", casePublicId: "jv-abc1234567", caption: "Acme v. Beta",
  courtName: "S.D.N.Y.", docketNumber: "1:26-cv-00001", eventKind: "docket_entry", occurredOn: "2026-11-02", summary: "New docket entry",
  ...overrides,
});

describe("entity alert copy", () => {
  it("never promises instant alerts and states the real check intervals", () => {
    const copy = [TIMING_NOTE, ...Object.values(FREQUENCY_LABEL), ...Object.values(KIND_EXPLAINER),
      ...Object.values(PLANS).flatMap((plan) => [plan.tagline, ...plan.features])].join(" ");
    expect(copy).not.toMatch(/\binstant\b/i);
    expect(TIMING_NOTE).toContain("every 5 to 60 minutes");
    expect(TIMING_NOTE).toContain("about every 2 hours");
    expect(TIMING_NOTE).toContain("about every 3 hours");
    expect(TIMING_NOTE).toContain("every 10 minutes");
  });

  it("groups matches per follow, links cases and caps each list", () => {
    const message = buildEntityDigestEmail({
      items: [item(), item({ followId: "f2", kind: "party", label: "Acme Widgets LLC", eventKind: "new_case", summary: "New case filed" })],
      more: new Map([["f1", 4]]),
      siteUrl: "https://jurvio.com", unsubscribeToken: "a".repeat(48), postalAddress: "Jurvio, PO Box 1", frequency: "asap",
    });
    expect(message.subject).toBe("6 new matches for 2 judges, topics and parties you follow");
    expect(message.text).toContain("Judge: Hon. Jane Roe");
    expect(message.text).toContain("Party: Acme Widgets LLC");
    expect(message.text).toContain("https://jurvio.com/case/jv-abc1234567");
    expect(message.text).toContain("…and 4 more on My alerts: https://jurvio.com/alerts");
    expect(message.text).toContain("sealed or restricted filings are never sent");
    expect(message.html).not.toContain("<script");
    expect(message.text).not.toMatch(/\binstant\b/i);
  });

  it("escapes captions in HTML", () => {
    const message = buildEntityDigestEmail({ items: [item({ caption: "<b>X</b> v. Y" })], more: new Map(),
      siteUrl: "https://jurvio.com", unsubscribeToken: "b".repeat(48), postalAddress: "x", frequency: "daily" });
    expect(message.html).toContain("&lt;b&gt;X&lt;/b&gt;");
    expect(message.subject).toBe("1 new match for judge Hon. Jane Roe");
  });

  it("is due on every tick for asap and once a day for daily", () => {
    const now = new Date("2026-11-03T12:00:00Z");
    expect(entityFollowDue("asap", now, now, now)).toBe(true);
    expect(entityFollowDue("daily", null, new Date("2026-11-03T00:00:00Z"), now)).toBe(false);
    expect(entityFollowDue("daily", null, new Date("2026-11-02T11:59:00Z"), now)).toBe(true);
    expect(entityFollowDue("daily", new Date("2026-11-02T12:01:00Z"), new Date("2026-10-01T00:00:00Z"), now)).toBe(true);
    expect(entityFollowDue("daily", new Date("2026-11-03T06:00:00Z"), new Date("2026-10-01T00:00:00Z"), now)).toBe(false);
  });
});

describe("matches label", () => {
  it("says 'since you followed' for new follows", async () => {
    const { matchesSinceLabel } = await import("../domain/entity-follow");
    const now = new Date("2026-11-03T06:00:00Z");
    expect(matchesSinceLabel(0, "2026-11-03 05:09:00.2+00", now)).toBe("0 matches since you followed (only new filings count, not earlier ones)");
    expect(matchesSinceLabel(1, "2026-10-01 05:09:00+00", now)).toBe("1 match in the last 7 days");
  });
});
