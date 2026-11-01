"use client";

import { useEffect, useRef, useState } from "react";
import { EmailCaptureForm, WAITLIST_SUCCESS } from "./email-capture-form";

export const PRICING_JOIN_ID = "join";
const SELECT_EVENT = "jurvio:pricing-plan";
const HINT = "jurvio_signed_in=1";

export interface PricingJoinOption {
  id: "free" | "plus" | "pro" | "team";
  name: string;
  /** Short price label, e.g. "$19/mo". */
  price: string;
}

/** Card buttons call this: pick the plan in the shared form, scroll to it and focus the email box. */
export function selectPricingPlan(plan: string) {
  window.dispatchEvent(new CustomEvent<string>(SELECT_EVENT, { detail: plan }));
}

/**
 * The one shared email box on narrow screens (/pricing#join): a plan picker
 * plus a single email field. Only rendered for plans that collect an email
 * (signed-out visitors while checkout / sign-in are off). It always posts to
 * /api/waitlist (with or without JavaScript), which hands a "free" choice on
 * to /api/auth/request with a 307 so the email and fields are re-posted.
 */
export function PricingJoinForm({ options, initialPlan, joinedPlan }: {
  options: readonly PricingJoinOption[];
  initialPlan: PricingJoinOption["id"];
  joinedPlan?: string | null;
}) {
  const [plan, setPlan] = useState(initialPlan);
  const [signedIn, setSignedIn] = useState(false);
  const email = useRef<HTMLInputElement>(null);
  const section = useRef<HTMLElement>(null);

  useEffect(() => {
    setSignedIn(document.cookie.split(";").some((part) => part.trim() === HINT));
    function onSelect(event: Event) {
      const id = (event as CustomEvent<string>).detail;
      const option = options.find((candidate) => candidate.id === id);
      if (!option) return;
      setPlan(option.id);
      const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      section.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      email.current?.focus({ preventScroll: true });
      window.history.replaceState(null, "", `?plan=${option.id}#${PRICING_JOIN_ID}`);
    }
    window.addEventListener(SELECT_EVENT, onSelect);
    return () => window.removeEventListener(SELECT_EVENT, onSelect);
  }, [options]);

  if (signedIn || options.length === 0) return null;
  const selected = options.find((option) => option.id === plan) ?? options[0]!;
  const joined = joinedPlan && options.some((option) => option.id === joinedPlan) ? WAITLIST_SUCCESS : undefined;

  return <section className="pricingJoin" id={PRICING_JOIN_ID} ref={section} aria-labelledby="pricing-join-title">
    <h2 id="pricing-join-title">Get notified when your plan opens</h2>
    <p>Pick a plan and leave your email. No password, no payment details.</p>
    <EmailCaptureForm
      action="/api/waitlist"
      hidden={{ next: "/account" }}
      buttonLabel={selected.id === "free" ? "Get started free" : `Join the ${selected.name} waitlist`}
      inputLabel={`Email address for the ${selected.name} plan`}
      initialMessage={joined}
      inputRef={email}
      className="pricingJoinForm"
    >
      <fieldset className="pricingJoinPlans">
        <legend>Plan</legend>
        {options.map((option) => <label key={option.id} className={option.id === selected.id ? "selected" : undefined}>
          <input type="radio" name="plan" value={option.id} checked={option.id === selected.id} onChange={() => setPlan(option.id)} />
          <span>{option.name}</span>
          <small>{option.price}</small>
        </label>)}
      </fieldset>
    </EmailCaptureForm>
  </section>;
}
