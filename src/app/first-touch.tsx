"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { FIRST_TOUCH_COOKIE, LAST_PUBLIC_PATH_COOKIE, isTrackablePublicPath } from "@/modules/growth/attribution";

const VISITOR_COOKIE = "jv_vid";
const SESSION_COOKIE = "jv_sid";

function readCookie(name: string): string | null {
  const hit = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : null;
}

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Browser-confirmed visits on public pages only (auth routes send no-referrer and are skipped).
 * Keeps random first-party ids (visitor 1 year, session 30 minutes sliding; the server stores only
 * salted hashes), stores first-touch attribution once, and beacons each page view. Public pages are
 * edge-cached, so this is the only signal that reliably sees humans.
 */
export function FirstTouch() {
  const pathname = usePathname();
  useEffect(() => {
    try {
      if (!pathname || !isTrackablePublicPath(pathname) || location.hostname.startsWith("z.")) return;
      const secure = location.protocol === "https:" ? "; Secure" : "";
      const set = (name: string, value: string, maxAge?: number) => {
        document.cookie = `${name}=${value}; Path=/; SameSite=Lax${maxAge ? `; Max-Age=${maxAge}` : ""}${secure}`;
      };
      set(VISITOR_COOKIE, readCookie(VISITOR_COOKIE) ?? randomId(), 365 * 86400);
      set(SESSION_COOKIE, readCookie(SESSION_COOKIE) ?? randomId(), 30 * 60);
      set(LAST_PUBLIC_PATH_COOKIE, encodeURIComponent(pathname.slice(0, 300)));
      let r: string | null = null;
      try { r = document.referrer ? new URL(document.referrer).hostname : null; } catch { r = null; }
      if (r === location.hostname) r = null;
      const first = !readCookie(FIRST_TOUCH_COOKIE);
      const q = new URLSearchParams(location.search);
      const ft = { r, l: pathname.slice(0, 300), us: q.get("utm_source"), um: q.get("utm_medium"), uc: q.get("utm_campaign"), t: Date.now() };
      if (first) set(FIRST_TOUCH_COOKIE, encodeURIComponent(JSON.stringify(ft)), 180 * 86400);
      const body = JSON.stringify({ ...ft, path: pathname.slice(0, 300), first });
      if (!navigator.sendBeacon?.("/api/visit", new Blob([body], { type: "application/json" }))) {
        void fetch("/api/visit", { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true });
      }
    } catch { /* attribution is best effort */ }
  }, [pathname]);
  return null;
}
