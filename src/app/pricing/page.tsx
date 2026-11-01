import type { Metadata } from "next";
import { PLAN_IDS, PLANS, formatMonthlyPrice } from "@/modules/accounts/domain/plans";
import { billingConfig, checkoutEnabled } from "@/modules/accounts/infrastructure/stripe";
import { PlanAction } from "@/modules/accounts/ui/plan-action";
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
  return <main className="accountShell wide">
    <header className="pricingHeader">
      <p className="accountEyebrow">Pricing</p>
      <h1>Every case page is free. Pay only for monitoring.</h1>
      <p className="accountIntro">Follow cases and get an email when new docket entries are filed. Upgrade for more follows and faster alerts.</p>
      {waitlistError ? <p className="accountNotice error" role="alert">{waitlistError}</p> : null}
    </header>
    <div className="pricingGrid">
      {PLAN_IDS.map((id) => {
        const plan = PLANS[id];
        return <section className={`accountCard pricingCard${id === "pro" ? " featured" : ""}`} key={id} aria-labelledby={`plan-${id}`}>
          <h2 id={`plan-${id}`}>{plan.name}</h2>
          <p className="pricingPrice">{plan.monthlyPriceUsd === 0 ? "$0" : `$${plan.monthlyPriceUsd}`}<span>{plan.monthlyPriceUsd === 0 ? " forever" : id === "team" ? "/mo for 5 seats" : "/mo"}</span></p>
          <p className="pricingTagline">{plan.tagline}</p>
          <ul>{plan.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
          <PlanAction plan={id} planName={plan.name} checkout={checkoutEnabled(config, id)} signInAvailable={canSignIn} />
          <span className="pricingSr">{plan.name}: {formatMonthlyPrice(plan)}</span>
        </section>;
      })}
    </div>
    <p className="accountFinePrint">Prices in US dollars. Paid plans are not open yet; join a waitlist with just your email and we will email you when they launch. Payment never changes case facts, rankings or explanations.</p>
  </main>;
}
