"use client";

import type { Route } from "next";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { FREQUENCY_LABEL, KIND_LABEL, type EntityFrequency, type EntityKind } from "../domain/entity-follow";
import { formatLimit } from "../domain/plans";
import "./follow-entity-button.css";

interface EntityApiState {
  signedIn: boolean;
  following?: boolean;
  frequency?: EntityFrequency | null;
  entityCount?: number;
  entityLimit?: number;
  asapAllowed?: boolean;
  error?: string;
  upgrade?: { name: string; entityFollowLimit: number } | null;
}

const HINT = "jurvio_signed_in=1";

/**
 * Follow a judge, topic or party. Signed-in state is fetched in the browser,
 * so the page HTML stays the same for everyone and edge-cacheable. `compact`
 * is the small inline version used next to party names on case pages.
 */
export function FollowEntityButton({ kind, target, name, compact = false }: {
  kind: EntityKind;
  /** Judge public id, topic slug or party entity public id. */
  target: string;
  /** Shown in the button's accessible name, e.g. the judge's name. */
  name: string;
  compact?: boolean;
}) {
  const [state, setState] = useState<EntityApiState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [frequency, setFrequency] = useState<EntityFrequency>("daily");
  const selectId = useId();
  const query = `kind=${encodeURIComponent(kind)}&target=${encodeURIComponent(target)}`;

  useEffect(() => {
    if (!document.cookie.split(";").some((part) => part.trim() === HINT)) {
      setState({ signedIn: false });
      return;
    }
    let cancelled = false;
    fetch(`/api/entity-follows?${query}`, { credentials: "same-origin", cache: "no-store" })
      .then((response): Promise<EntityApiState> | EntityApiState => response.ok || response.status === 404 ? response.json() as Promise<EntityApiState> : { signedIn: false })
      .then((body) => {
        if (cancelled) return;
        setState(body);
        if (body.frequency) setFrequency(body.frequency);
      })
      .catch(() => { if (!cancelled) setState({ signedIn: false }); });
    return () => { cancelled = true; };
  }, [query]);

  async function send(method: "POST" | "DELETE", nextFrequency: EntityFrequency) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/entity-follows", {
        method,
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ kind, target, frequency: nextFrequency }),
      });
      if (response.status === 401) { setState({ signedIn: false }); return; }
      const body = await response.json() as EntityApiState;
      setState(body);
      if (body.frequency) setFrequency(body.frequency);
      if (!body.error) setMessage(!body.following ? "Stopped following."
        : body.frequency === "asap" ? "Following. We email you when Jurvio finds a match." : "Following. You get a daily digest of matches.");
    } catch {
      setMessage("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const kindWord = KIND_LABEL[kind].toLowerCase();
  const rootClass = compact ? "entityFollow entityFollowCompact" : "entityFollow";

  if (state === null) {
    return <span className={rootClass} aria-busy="true">
      <button type="button" className="entityFollowButton" disabled>{compact ? "Follow" : `Follow ${kindWord}`}</button>
    </span>;
  }

  if (!state.signedIn) {
    const next = typeof window === "undefined" ? "/alerts" : window.location.pathname;
    return <span className={rootClass}>
      <Link className="entityFollowButton" href={`/signin?next=${encodeURIComponent(next)}` as Route} rel="nofollow"
        aria-label={`Follow ${name}: sign in to get email alerts`}>
        {compact ? "Follow" : `Follow ${kindWord}`}
      </Link>
      {compact ? null : <small className="entityFollowNote">Sign in to get email alerts. Free includes one judge, topic, party or emergency docket feed.</small>}
    </span>;
  }

  const frequencyPicker = <span className="entityFollowFrequency">
    <label htmlFor={selectId}>{compact ? <span className="srOnly">Alert frequency for {name}</span> : "Email me"}</label>
    <select id={selectId} value={frequency} disabled={busy} onChange={(event) => {
      const next = event.target.value as EntityFrequency;
      setFrequency(next);
      if (state.following) void send("POST", next);
    }}>
      <option value="daily">{FREQUENCY_LABEL.daily}</option>
      {state.asapAllowed === false ? null : <option value="asap">{FREQUENCY_LABEL.asap}</option>}
    </select>
  </span>;

  return <span className={rootClass}>
    <span className="entityFollowRow">
      <button type="button" className={state.following ? "entityFollowButton following" : "entityFollowButton"} disabled={busy}
        aria-pressed={Boolean(state.following)} aria-label={state.following ? `Following ${name}. Click to unfollow.` : `Follow ${name}`}
        onClick={() => void send(state.following ? "DELETE" : "POST", frequency)}>
        {state.following ? "Following ✓" : compact ? "Follow" : `Follow ${kindWord}`}
      </button>
      {!compact || state.following ? frequencyPicker : null}
    </span>
    {state.error === "limit_reached" ? <span className="entityFollowUpgrade" role="alert">
      Your plan includes {formatLimit(state.entityLimit ?? 1)} judge, topic, party or emergency feed {state.entityLimit === 1 ? "follow" : "follows"} ({state.entityCount} used).
      {state.upgrade ? <> {state.upgrade.name} raises this to {formatLimit(state.upgrade.entityFollowLimit)}: upgrade coming soon.</> : null}
      {" "}<Link href="/alerts">Manage alerts</Link> · <Link href={"/pricing" as Route}>See plans</Link>
    </span> : null}
    {!compact && !state.error ? <small className="entityFollowNote">
      {typeof state.entityCount === "number" ? <>{state.entityCount} of {formatLimit(state.entityLimit ?? 1)} judge, topic, party and feed follows used · </> : null}
      <Link href="/alerts">My alerts</Link>
    </small> : null}
    <span role="status" aria-live="polite" className="entityFollowStatus">{message}</span>
  </span>;
}
