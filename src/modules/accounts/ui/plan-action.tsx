"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const HINT = "jurvio_signed_in=1";

/**
 * The pricing-card button. With checkout enabled it posts to Stripe Checkout;
 * otherwise it is "Coming soon": signed-in visitors join the plan's waitlist,
 * signed-out visitors sign in first. Signed-in state is read in the browser so
 * /pricing stays one cacheable page.
 */
export function PlanAction({ plan, planName, checkout }: { plan: "free" | "plus" | "pro" | "team"; planName: string; checkout: boolean }) {
  const [signedIn, setSignedIn] = useState(false);
  const [joined, setJoined] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setSignedIn(document.cookie.split(";").some((part) => part.trim() === HINT));
    if (new URLSearchParams(window.location.search).get("joined") === plan) setJoined(true);
  }, [plan]);

  if (plan === "free") {
    return signedIn
      ? <Link className="accountButton secondary" href="/account">Your account</Link>
      : <Link className="accountButton" href="/signin?next=/account">Get started free</Link>;
  }
  if (checkout) {
    return signedIn
      ? <form action="/api/billing/checkout" method="post"><input type="hidden" name="plan" value={plan} /><button className="accountButton" type="submit">Choose {planName}</button></form>
      : <Link className="accountButton" href="/signin?next=/pricing">Sign in to choose {planName}</Link>;
  }
  if (joined) return <p className="pricingJoined" role="status">You are on the {planName} waitlist. We will email you when it opens.</p>;
  if (!signedIn) {
    return <div className="pricingSoon"><span>Coming soon</span><Link className="accountButton secondary" href="/signin?next=/pricing">Sign in to join the waitlist</Link></div>;
  }
  return <div className="pricingSoon">
    <span>Coming soon</span>
    <button className="accountButton secondary" type="button" disabled={busy} onClick={async () => {
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/waitlist", {
          method: "POST", credentials: "same-origin",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ plan }),
        });
        if (response.status === 401) { setSignedIn(false); return; }
        if (!response.ok) throw new Error("failed");
        setJoined(true);
      } catch {
        setError("Could not join the waitlist. Try again.");
      } finally {
        setBusy(false);
      }
    }}>Join the {planName} waitlist</button>
    {error ? <small role="alert">{error}</small> : null}
  </div>;
}
