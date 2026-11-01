"use client";

import { useEffect } from "react";

const HINT = "jurvio_signed_in=1";
const PARAM = "subscriber";

/**
 * The anonymous gate HTML may be served from the shared edge cache even to a
 * signed-in subscriber. When the browser has the signed-in hint, reload once
 * with ?subscriber=1: that URL is never edge-cached, so the origin checks the
 * session and renders the full record for a paid plan (or the gate again).
 */
export function SubscriberGateRefresh() {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has(PARAM)) return;
    if (!document.cookie.split(";").some((part) => part.trim() === HINT)) return;
    url.searchParams.set(PARAM, "1");
    window.location.replace(url.toString());
  }, []);
  return null;
}
