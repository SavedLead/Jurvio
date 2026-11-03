import * as React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PLANS, UNLIMITED } from "../domain/plans";
import type { PricingJoinOption } from "./pricing-join-form";

// Vitest compiles JSX with the classic runtime here; Next uses the automatic one.
(globalThis as { React?: typeof React }).React = React;
// Imported after the global is set: pricing-content builds JSX at module load.
const { PlanAction } = await import("./plan-action");
const { FEATURED_BADGE, FEATURED_PLAN, PRICING_FAQ, priceNote } = await import("./pricing-content");
const { PricingJoinForm } = await import("./pricing-join-form");

// Waitlist mode: email sign-in off in production (Stripe off comes from the empty env).
vi.mock("@/modules/accounts/http/config", () => ({ signInAvailable: () => false }));

const OPTIONS: PricingJoinOption[] = [
  { id: "free", name: "Free", price: "$0" },
  { id: "plus", name: "Plus", price: "$19/mo" },
  { id: "pro", name: "Pro", price: "$59/mo" },
  { id: "team", name: "Team", price: "$199/mo" },
];

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe("pricing content", () => {
  it("keeps the approved prices, names and limits", () => {
    expect([PLANS.free, PLANS.plus, PLANS.pro, PLANS.team].map((plan) => [plan.name, plan.monthlyPriceUsd, plan.followLimit, plan.seats]))
      .toEqual([["Free", 0, 5, 1], ["Plus", 19, 50, 1], ["Pro", 59, UNLIMITED, 1], ["Team", 199, UNLIMITED, 5]]);
  });

  it("states seats and 'Free forever' under the price", () => {
    expect(priceNote("free")).toBe("Free forever");
    expect(priceNote("plus")).toBe("1 seat");
    expect(priceNote("pro")).toBe("1 seat");
    expect(priceNote("team")).toBe("for 5 seats");
  });

  it("highlights Pro without claiming popularity before launch", () => {
    expect(FEATURED_PLAN).toBe("pro");
    expect(FEATURED_BADGE).toBe("Recommended");
  });

  it("FAQ strip has no invented numbers or testimonials", () => {
    const html = renderToStaticMarkup(<>{PRICING_FAQ.map((item) => <div key={item.q}>{item.q}{item.a}</div>)}</>);
    expect(html).not.toMatch(/\d/);
    expect(html).not.toMatch(/[“”"]\s*[-–—]\s*[A-Z]/);
    expect(html).toContain("not legal advice");
    expect(html).toContain("Public court records");
    expect(html).toContain('href="/methodology"');
  });
});

describe("PlanAction (signed out, waitlist mode)", () => {
  it("renders the card's own email box plus a small-screen button that jumps to the shared form", () => {
    const html = renderToStaticMarkup(<PlanAction plan="pro" planName="Pro" checkout={false} signInAvailable={false} />);
    expect(html).toContain("Coming soon");
    expect(count(html, 'type="email"')).toBe(1);
    expect(html).toContain('class="accountButton pricingCaptureJump" href="/pricing?plan=pro#join"');
    expect(count(html, "Join the Pro waitlist")).toBe(2);
  });

  it("free card lines up with the paid cards (label + box + button, no extra footnote)", () => {
    const html = renderToStaticMarkup(<PlanAction plan="free" planName="Free" checkout={false} signInAvailable={false} />);
    expect(html).toContain("Opening soon");
    expect(html).not.toContain("Leave your email");
    expect(html).toContain('href="/pricing?plan=free#join"');
  });

  it("checkout mode keeps a plain button/link (no email boxes)", () => {
    const html = renderToStaticMarkup(<PlanAction plan="plus" planName="Plus" checkout={true} />);
    expect(html).not.toContain('type="email"');
    expect(html).toContain("Sign in to choose Plus");
  });
});

describe("PricingJoinForm (one shared email box on small screens)", () => {
  it("has one email field, a labelled plan picker and posts to /api/waitlist", () => {
    const html = renderToStaticMarkup(<PricingJoinForm options={OPTIONS} initialPlan="team" />);
    expect(html).toContain('id="join"');
    expect(count(html, 'type="email"')).toBe(1);
    expect(count(html, 'type="radio"')).toBe(4);
    expect(html).toContain("<legend>Plan</legend>");
    expect(html).toMatch(/checked="" value="team"/);
    expect(html).toContain('action="/api/waitlist"');
    expect(html).toContain("Join the Team waitlist");
    expect(html).toContain('aria-label="Email address for the Team plan"');
  });

  it("free choice says 'Get started free' and carries next=/account", () => {
    const html = renderToStaticMarkup(<PricingJoinForm options={OPTIONS} initialPlan="free" />);
    expect(html).toContain("Get started free");
    expect(html).toContain('name="next" value="/account"');
  });

  it("shows the success message after a no-JS join and nothing when no plan collects email", () => {
    expect(renderToStaticMarkup(<PricingJoinForm options={OPTIONS} initialPlan="pro" joinedPlan="pro" />)).toContain("on the list");
    expect(renderToStaticMarkup(<PricingJoinForm options={[]} initialPlan="free" />)).toBe("");
  });
});

describe("/pricing page", () => {
  async function render(params: Record<string, string> = {}) {
    const { default: PricingPage } = await import("@/app/pricing/page");
    return renderToStaticMarkup(await PricingPage({ searchParams: Promise.resolve(params) }));
  }

  it("renders four plans with unchanged prices, a badge on Pro, one shared form and the FAQ strip", async () => {
    const html = await render();
    expect(count(html, 'class="accountCard pricingCard')).toBe(4);
    for (const price of ["$0", "$19", "$59", "$199"]) expect(html).toContain(`${price}<span class="pricingUnit">/mo</span>`);
    expect(html).toContain("for 5 seats");
    expect(html).toMatch(/pricingCard featured" id="plan-pro"[^>]*><p class="pricingBadge">Recommended<\/p>/);
    expect(count(html, 'id="join"')).toBe(1);
    expect(html).toMatch(/checked="" value="pro"/);
    expect(html).toContain("Good to know");
    expect(html).toContain("pricingFinePrint");
  });

  it("preselects the plan from ?plan= (no-JS card buttons)", async () => {
    expect(await render({ plan: "plus" })).toMatch(/checked="" value="plus"/);
    expect(await render({ plan: "bogus" })).toMatch(/checked="" value="pro"/);
  });
});

describe("pricing CSS", () => {
  const css = readFileSync(new URL("../../../app/account-pages.css", import.meta.url), "utf8");
  it("centers a wide grid, pins CTAs and swaps card boxes for the shared form on small screens", () => {
    expect(css).toMatch(/\.pricingGrid \{[^}]*repeat\(4, minmax\(0, 1fr\)\)/);
    expect(css).toMatch(/\.pricingFeatures \{[^}]*flex: 1/);
    expect(css).toMatch(/@media \(max-width: 639px\)[\s\S]*\.pricingCaptureInline \{ display: none; \}[\s\S]*\.pricingJoin \{ display: block;/);
  });
});
