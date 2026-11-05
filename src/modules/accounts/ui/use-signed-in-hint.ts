"use client";

import { useEffect, useState } from "react";

const HINT = "jurvio_signed_in=1";
const CHECKED_KEY = "jurvio_hint_checked";
let pending: Promise<boolean> | null = null;

export function hasSignedInHint(): boolean {
  return typeof document !== "undefined" && document.cookie.split(";").some((part) => part.trim() === HINT);
}

/**
 * A cached page can't tell who is looking, so the browser decides. If the hint
 * cookie is missing, ask the origin once per tab session (one shared request per
 * page): it sets the hint when a session cookie is present.
 */
export function confirmSignedIn(): Promise<boolean> {
  if (hasSignedInHint()) return Promise.resolve(true);
  try { if (sessionStorage.getItem(CHECKED_KEY)) return Promise.resolve(false); } catch { /* storage blocked */ }
  pending ??= fetch("/api/auth/session-hint", { credentials: "same-origin", cache: "no-store" })
    .then((response) => (response.ok ? response.json() : { signedIn: false }))
    .then((body: { signedIn?: boolean }) => {
      try { sessionStorage.setItem(CHECKED_KEY, "1"); } catch { /* storage blocked */ }
      return Boolean(body.signedIn) || hasSignedInHint();
    })
    .catch(() => false);
  return pending;
}

export function useSignedInHint(): boolean {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    let live = true;
    if (hasSignedInHint()) setSignedIn(true);
    else void confirmSignedIn().then((value) => { if (live && value) setSignedIn(true); });
    return () => { live = false; };
  }, []);
  return signedIn;
}
