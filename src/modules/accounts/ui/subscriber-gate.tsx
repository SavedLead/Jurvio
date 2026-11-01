import type { Metadata, Route } from "next";
import Link from "next/link";
import { SubscriberGateRefresh } from "./subscriber-gate-refresh";
import "../../../app/account-pages.css";

export const SUBSCRIBER_GATE_TITLE = "Case record available to subscribers";

/** Metadata for a gated case URL: generic title, nothing about the case, never indexed. */
export function subscriberGateMetadata(): Metadata {
  return {
    title: { absolute: `${SUBSCRIBER_GATE_TITLE} | Jurvio` },
    description: "This court record is available to Jurvio subscribers.",
    robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false, noimageindex: true } },
    openGraph: { title: SUBSCRIBER_GATE_TITLE, description: "Available to Jurvio subscribers." },
    twitter: { card: "summary", title: SUBSCRIBER_GATE_TITLE },
  };
}

/**
 * The whole page for a subscriber-only case when the viewer is not a paid
 * subscriber. It deliberately takes no case data: no caption, parties,
 * docket, court, dates or text can leak into the HTML.
 */
export function SubscriberCaseGate({ path }: { path: string }) {
  return <main className="accountShell">
    <section className="accountCard" aria-labelledby="subscriber-gate-title">
      <p className="accountEyebrow">Restricted case record</p>
      <h1 id="subscriber-gate-title">Available to subscribers</h1>
      <p className="accountIntro">This court record is available to signed-in Jurvio subscribers on a paid plan. It is not listed in public search.</p>
      <p><Link className="accountButton" href={"/pricing" as Route}>See plans</Link></p>
      <p className="accountFinePrint">Already a subscriber? <Link href={`/signin?next=${encodeURIComponent(path)}` as Route}>Sign in</Link>. Every other case page on Jurvio stays free to read.</p>
      <SubscriberGateRefresh />
    </section>
  </main>;
}
