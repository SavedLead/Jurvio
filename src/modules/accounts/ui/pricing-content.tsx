import type { ReactNode } from "react";
import Link from "next/link";
import { PLANS, type PlanId } from "../domain/plans";

/** The highlighted plan. "Recommended", not "Most popular": paid plans have not launched, so there is no popularity to claim yet. */
export const FEATURED_PLAN: PlanId = "pro";
export const FEATURED_BADGE = "Recommended";

/** Line under the price: seats for paid plans, "Free forever" for Free. */
export function priceNote(id: PlanId): string {
  const plan = PLANS[id];
  if (plan.monthlyPriceUsd === 0) return "Free forever";
  return plan.seats === 1 ? "1 seat" : `for ${plan.seats} seats`;
}

/**
 * The "Good to know" strip under the plans. Short, true statements only: no
 * testimonials and no invented numbers. Each answer restates something the
 * product already does or the site already says (plans.ts, /methodology,
 * the footer's not-legal-advice line, the waitlist form).
 */
export const PRICING_FAQ: ReadonlyArray<{ q: string; a: ReactNode }> = [
  { q: "What does following a case mean?", a: <>We email you when Jurvio picks up new docket entries or citing opinions in a case you follow. Free, Pro, and Team are emailed every ten minutes; Plus is hourly. Unfollow any time from <Link href="/account">your account</Link>.</> },
  { q: "Can I follow a judge, a topic or a party?", a: <>Yes. Use Follow on a judge page, a <Link href="/topics">topic page</Link> or next to a party on a case page, and choose a daily digest or an email as soon as Jurvio sees a match. Free includes one; Pro has no limit. Manage them on <Link href="/alerts">My alerts</Link>.</> },
  { q: "How quickly do new filings reach Jurvio?", a: <>Alerts are not instant. Jurvio checks each court on its own schedule, from every few minutes for federal appeals courts and open <Link href="/supreme-court/emergency">Supreme Court emergency applications</Link> (usually within ten to twenty minutes of the Court posting) to every few hours for district courts and the rest of the Supreme Court docket, so a new filing can take a few hours to appear. Alert timing counts from when Jurvio picks up an entry.</> },
  { q: "Where does the data come from?", a: <>Public court records and other official public sources. Case pages link to the source records that are available. See <Link href="/methodology">sources and methodology</Link>.</> },
  { q: "Is reading cases free?", a: <>Yes. Public case pages are free to read on every plan. Plans only change how many cases, judges, topics and parties you can follow and how fast alerts arrive.</> },
  { q: "Can I cancel?", a: <>Yes. Paid plans are month to month and you can cancel at any time.</> },
  { q: "What do I need to join a waitlist?", a: <>Just your email address. No password and no payment details.</> },
  { q: "Is this legal advice?", a: <>No. Jurvio provides public-record information and general legal education, not legal advice.</> },
];
