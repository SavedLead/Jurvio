"use client";

import type { Route } from "next";
import Link from "next/link";
import { useEffect, useState } from "react";
import "./follow-case-box.css";

interface FollowApiState {
  signedIn: boolean;
  eligible?: boolean;
  following?: boolean;
  followCount?: number;
  followLimit?: number;
  error?: string;
  upgrade?: { name: string; monthlyPriceUsd: number; followLimit: number } | null;
}

const HINT = "jurvio_signed_in=1";

/**
 * "Follow this case". The page only renders this for cases that may be
 * followed; the follow API re-checks. Signed-out visitors get an email box that
 * starts the one-time-link sign-in and follows the case when the link is
 * opened. Signed-in state is fetched in the browser, so the case page HTML is
 * identical for everyone and stays edge-cacheable.
 */
export function FollowCaseBox({ caseId }: { caseId: string }) {
  const [state, setState] = useState<FollowApiState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const note = new URLSearchParams(window.location.search).get("follow");
    if (note === "followed") setMessage("You are now following this case.");
    if (!document.cookie.split(";").some((part) => part.trim() === HINT)) {
      setState({ signedIn: false });
      return;
    }
    let cancelled = false;
    fetch(`/api/follows/${encodeURIComponent(caseId)}`, { credentials: "same-origin", cache: "no-store" })
      .then((response): Promise<FollowApiState> | FollowApiState => response.ok ? response.json() as Promise<FollowApiState> : { signedIn: false })
      .then((body) => { if (!cancelled) setState(note === "limit" && body.signedIn && !body.following ? { ...body, error: "limit_reached" } : body); })
      .catch(() => { if (!cancelled) setState({ signedIn: false }); });
    return () => { cancelled = true; };
  }, [caseId]);

  async function toggle() {
    if (!state?.signedIn) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/follows/${encodeURIComponent(caseId)}`, {
        method: state.following ? "DELETE" : "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      const body = await response.json() as FollowApiState;
      if (response.status === 401) { setState({ signedIn: false }); return; }
      setState(body);
      if (!body.error) setMessage(body.following ? "You are now following this case." : "You stopped following this case.");
    } catch {
      setMessage("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (state === null) return <section id="follow" className="followCaseBox" aria-busy="true" aria-label="Follow this case" />;
  if (state.signedIn && state.eligible === false) return null;

  return <section id="follow" className="followCaseBox" aria-labelledby="follow-case-title">
    <h2 id="follow-case-title">Follow this case</h2>
    {!state.signedIn ? <>
      <p>Get an email when new docket entries are filed. Free for up to 3 cases.</p>
      <form action="/api/auth/request" method="post">
        <input type="email" name="email" required maxLength={254} autoComplete="email" placeholder="you@example.com" aria-label="Email address" />
        <input type="hidden" name="next" value={`/case/${caseId}`} />
        <input type="hidden" name="follow" value={caseId} />
        <button type="submit">Follow by email</button>
      </form>
      <small>We email a one-time sign-in link. No password.</small>
    </> : <>
      <p>{state.following ? "You get an email when new docket entries are filed." : "Get an email when new docket entries are filed."}</p>
      <button type="button" className={state.following ? "following" : undefined} disabled={busy} onClick={toggle} aria-pressed={Boolean(state.following)}>
        {state.following ? "Following ✓ (unfollow)" : "Follow this case"}
      </button>
      {typeof state.followCount === "number" ? <small>{state.followCount} of {state.followLimit} follows used · <Link href="/account">Manage</Link></small> : null}
      {state.error === "limit_reached" ? <p className="followUpgrade" role="alert">
        You are following {state.followCount} of {state.followLimit} cases on your plan.
        {state.upgrade ? <> {state.upgrade.name} (${state.upgrade.monthlyPriceUsd}/mo) follows up to {state.upgrade.followLimit}. </> : " "}
        <Link href={"/pricing" as Route}>See plans</Link>
      </p> : null}
    </>}
    <span role="status" aria-live="polite">{message ? <small>{message}</small> : null}</span>
  </section>;
}
