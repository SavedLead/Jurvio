"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EmailCaptureForm, WAITLIST_SUCCESS } from "./email-capture-form";

const HINT = "jurvio_signed_in=1";

/**
 * The pricing-card button. With checkout enabled it posts to Stripe Checkout;
 * otherwise it is "Coming soon": signed-in visitors join the plan's waitlist,
 * signed-out visitors join by email (no sign-in needed). While email sign-in
 * is not configured, "Get started free" is an email box on the waitlist too.
 * Signed-in state is read in the browser so /pricing stays one cacheable page.
 */
export function PlanAction({ plan, planName, checkout, signInAvailable = true }: { plan: "free" | "plus" | "pro" | "team"; planName: string; checkout: boolean; signInAvailable?: boolean }) {
  const [signedIn, setSignedIn] = useState(false);
  const [joined, setJoined] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setSignedIn(document.cookie.split(";").some((part) => part.trim() === HINT));
    if (new URLSearchParams(window.location.search).get("joined") === plan) setJoined(true);
  }, [plan]);

  if (plan === "free") {
    if (signedIn) return <Link className="accountButton secondary" href="/account">Your account</Link>;
    if (!signInAvailable) {
      return <EmailCaptureForm action="/api/auth/request" hidden={{ next: "/account" }} buttonLabel="Get started free"
        inputLabel="Email address for the free plan" footnote="Free accounts open soon. Leave your email and we'll tell you when." />;
    }
    return <Link className="accountButton" href="/signin?next=/account">Get started free</Link>;
  }
  if (checkout) {
    return signedIn
      ? <form action="/api/billing/checkout" method="post"><input type="hidden" name="plan" value={plan} /><button className="accountButton" type="submit">Choose {planName}</button></form>
      : <Link className="accountButton" href="/signin?next=/pricing">Sign in to choose {planName}</Link>;
  }
  if (joined) return <p className="pricingJoined" role="status">{signedIn ? `You are on the ${planName} waitlist. We will email you when it opens.` : WAITLIST_SUCCESS}</p>;
  if (!signedIn) {
    return <div className="pricingSoon"><span>Coming soon</span>
      <EmailCaptureForm action="/api/waitlist" hidden={{ plan }} buttonLabel={`Join the ${planName} waitlist`} inputLabel={`Email address for the ${planName} waitlist`} />
    </div>;
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
