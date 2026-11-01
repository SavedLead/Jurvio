import type { Metadata } from "next";
import { PLAN_IDS, PLANS, formatMonthlyPrice, isPlanId } from "@/modules/accounts/domain/plans";
import { FEATURED_BADGE, FEATURED_PLAN, PRICING_FAQ, priceNote } from "@/modules/accounts/ui/pricing-content";
import { billingConfig, checkoutEnabled } from "@/modules/accounts/infrastructure/stripe";
import { PlanAction } from "@/modules/accounts/ui/plan-action";
import { PricingJoinForm, type PricingJoinOption } from "@/modules/accounts/ui/pricing-join-form";
import { signInAvailable } from "@/modules/accounts/http/config";
import { robotsFor } from "@/lib/seo/indexing";
import "../account-pages.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Pricing",
  description: "Jurvio is free to read. Follow cases and get docket alerts on Free, Plus, Pro and Team plans.",
  alternates: { canonical: "/pricing" },
  robots: robotsFor(true),
};

const WAITLIST_ERRORS: Record<string, string> = {
  invalid: "Enter a valid email address to join the waitlist.",
  rate_limited: "Too many requests. Wait a few minutes and try again.",
};

export default async function PricingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const config = billingConfig();
  const canSignIn = signInAvailable();
  const waitlistError = params.waitlist_error ? WAITLIST_ERRORS[params.waitlist_error] ?? null : null;
  // Plans that collect an email from signed-out visitors (waitlist mode): they share one form on small screens.
  const joinOptions: PricingJoinOption[] = PLAN_IDS
    .filter((id) => id === "free" ? !canSignIn : !checkoutEnabled(config, id))
    .map((id) => ({ id, name: PLANS[id].name, price: formatMonthlyPrice(PLANS[id]) }));
  const requested = isPlanId(params.plan) ? params.plan : null;
  const initialPlan = joinOptions.find((option) => option.id === requested)?.id
    ?? joinOptions.find((option) => option.id === FEATURED_PLAN)?.id
    ?? joinOptions[0]?.id ?? "free";
  return <main className="accountShell pricingShell">
    <header className="pricingHeader">
      <p className="accountEyebrow">Pricing</p>
      <h1>Every case page is free. Pay only for monitoring.</h1>
      <p className="accountIntro">Follow cases and get an email when new docket entries are filed. Upgrade for more follows and faster alerts.</p>
      {waitlistError ? <p className="accountNotice error" role="alert">{waitlistError}</p> : null}
    </header>
    <div className="pricingGrid">
      {PLAN_IDS.map((id) => {
        const plan = PLANS[id];
        const featured = id === FEATURED_PLAN;
        return <section className={`accountCard pricingCard${featured ? " featured" : ""}`} key={id} id={`plan-${id}`} aria-labelledby={`plan-${id}-name`}>
          {featured ? <p className="pricingBadge">{FEATURED_BADGE}</p> : null}
          <div className="pricingCardHead">
            <h2 id={`plan-${id}-name`}>{plan.name}</h2>
            <div className="pricingPriceBlock">
              <p className="pricingPrice" aria-hidden="true">${plan.monthlyPriceUsd}<span className="pricingUnit">/mo</span></p>
              <p className={`pricingNote${plan.seats > 1 ? " seats" : ""}`} aria-hidden="true">{priceNote(id)}</p>
              <span className="pricingSr">{formatMonthlyPrice(plan)}, {priceNote(id)}</span>
            </div>
          </div>
          <p className="pricingTagline">{plan.tagline}</p>
          <ul className="pricingFeatures">{plan.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
          <div className="pricingAction">
            <PlanAction plan={id} planName={plan.name} checkout={checkoutEnabled(config, id)} signInAvailable={canSignIn} />
          </div>
        </section>;
      })}
    </div>
    <PricingJoinForm options={joinOptions} initialPlan={initialPlan} joinedPlan={params.joined ?? null} />
    <p className="pricingFinePrint">Prices in US dollars. Paid plans are not open yet; join a waitlist with just your email and we will email you when they launch. Payment never changes case facts, rankings or explanations.</p>
    <p className="pricingFinePrint">How fresh alerts are: alert emails go out daily (Free), hourly (Plus) or every 10 minutes (Pro and Team), counted from when Jurvio picks up a new entry. Jurvio checks federal appeals courts every 5 to 60 minutes, district court docket feeds about every 2 hours, the Supreme Court docket every 3 hours and other active federal cases about every 6 hours, and processes CourtListener&apos;s monthly bulk data overnight. New citing opinions are matched about every 15 minutes after they arrive.</p>
    <section className="pricingFaq" aria-labelledby="pricing-faq-title">
      <h2 id="pricing-faq-title">Good to know</h2>
      <dl>
        {PRICING_FAQ.map((item) => <div key={item.q}><dt>{item.q}</dt><dd>{item.a}</dd></div>)}
      </dl>
    </section>
  </main>;
}
