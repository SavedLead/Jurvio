"use client";

import type { Route } from "next";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PLANS, formatLimit } from "../domain/plans";
import { EmailCaptureForm, WAITLIST_SUCCESS } from "./email-capture-form";
import "./follow-case-box.css";

interface FollowApiState {
  signedIn: boolean;
  eligible?: boolean;
  following?: boolean;
  activity?: boolean;
  citations?: boolean;
  followCount?: number;
  followLimit?: number;
  error?: string;
  upgrade?: { name: string; monthlyPriceUsd: number; followLimit: number } | null;
}

const HINT = "jurvio_signed_in=1";
const FREE_FOLLOW_LIMIT = PLANS.free.followLimit;

/**
 * "Follow this case". The page only renders this for cases that may be
 * followed; the follow API re-checks. Signed-out visitors get an email box that
 * starts the one-time-link sign-in and follows the case when the link is
 * opened. While email sign-in is not configured, the same box puts the email
 * and case on the waitlist (converted to a real follow at sign-up). Signed-in state is fetched in the browser, so the case page HTML is
 * identical for everyone and stays edge-cacheable.
 *
 * Two kinds, each its own toggle: docket activity (new entries) and citations
 * (new opinions on Jurvio citing this case; natural for old or closed cases).
 * `citationsFirst` pre-ticks citations instead of activity for signed-out
 * visitors on cases whose docket is unlikely to move.
 */
export function FollowCaseBox({ caseId, citationsFirst = false }: { caseId: string; citationsFirst?: boolean }) {
  const [state, setState] = useState<FollowApiState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [waitlisted, setWaitlisted] = useState(false);

  useEffect(() => {
    const note = new URLSearchParams(window.location.search).get("follow");
    if (note === "followed") setMessage("You are now following this case.");
    if (note === "waitlisted") setWaitlisted(true);
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

  async function setKinds(next: { activity: boolean; citations: boolean }) {
    if (!state?.signedIn) return;
    setBusy(true);
    setMessage("");
    try {
      const off = !next.activity && !next.citations;
      const response = await fetch(`/api/follows/${encodeURIComponent(caseId)}`, {
        method: off ? "DELETE" : "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: off ? undefined : JSON.stringify(next),
      });
      const body = await response.json() as FollowApiState;
      if (response.status === 401) { setState({ signedIn: false }); return; }
      setState(body);
      if (!body.error) setMessage(!body.following ? "You stopped following this case."
        : body.activity && body.citations ? "You get docket and citation alerts for this case."
        : body.citations ? "You get an email when a new opinion cites this case."
        : "You get an email when new docket entries are filed.");
    } catch {
      setMessage("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const toggle = (kind: "activity" | "citations") => setKinds({
    activity: kind === "activity" ? !state?.activity : Boolean(state?.activity),
    citations: kind === "citations" ? !state?.citations : Boolean(state?.citations),
  });

  if (state === null) return <section id="follow" className="followCaseBox" aria-busy="true" aria-label="Follow this case" />;
  if (state.signedIn && state.eligible === false) return null;

  return <section id="follow" className="followCaseBox" aria-labelledby="follow-case-title">
    <h2 id="follow-case-title">Follow this case</h2>
    {!state.signedIn ? <>
      <p>Get an email when new docket entries are filed or a new opinion cites this case. Free for up to {FREE_FOLLOW_LIMIT} cases. <Link className="followPlansLink" href={"/pricing" as Route}>See plans</Link></p>
      <EmailCaptureForm
        action="/api/auth/request"
        hidden={{ next: `/case/${caseId}`, follow: caseId, follow_kinds: "1" }}
        buttonLabel="Follow by email"
        initialMessage={waitlisted ? WAITLIST_SUCCESS : undefined}
        footnote="No password. We only email you about cases you follow."
        fieldsBeforeButton={<fieldset className="followKinds">
          <legend>Email me about</legend>
          <label><input type="checkbox" name="follow_activity" value="on" defaultChecked={!citationsFirst} /> New docket entries</label>
          <label><input type="checkbox" name="follow_citations" value="on" defaultChecked={citationsFirst} /> New opinions citing this case</label>
        </fieldset>}
      />
    </> : <>
      <p>{state.following ? "Choose what you get emails about." : "Get an email when new docket entries are filed or a new opinion cites this case."}</p>
      <div className="followKinds" role="group" aria-label="Follow alerts">
        <button type="button" className={state.activity ? "following" : undefined} disabled={busy} onClick={() => toggle("activity")} aria-pressed={Boolean(state.activity)}>
          {state.activity ? "Docket activity ✓" : "Follow docket activity"}
        </button>
        <button type="button" className={state.citations ? "following" : undefined} disabled={busy} onClick={() => toggle("citations")} aria-pressed={Boolean(state.citations)}>
          {state.citations ? "Citations ✓" : "Follow citations"}
        </button>
      </div>
      {typeof state.followCount === "number" ? <small>{state.followCount} of {formatLimit(state.followLimit ?? 0)} follows used · <Link href={"/alerts" as Route}>Manage</Link>{state.error === "limit_reached" ? null : <> · <Link href={"/pricing" as Route}>See plans</Link></>}</small> : null}
      {state.error === "limit_reached" ? <p className="followUpgrade" role="alert">
        You are following {state.followCount} of {formatLimit(state.followLimit ?? 0)} cases on your plan.
        {state.upgrade ? <> {state.upgrade.name} follows {formatLimit(state.upgrade.followLimit) === "unlimited" ? "unlimited cases" : `up to ${formatLimit(state.upgrade.followLimit)}`}: upgrade coming soon. </> : " "}
        <Link href={"/pricing" as Route}>See plans</Link>
      </p> : null}
    </>}
    <span role="status" aria-live="polite">{message ? <small>{message}</small> : null}</span>
  </section>;
}
