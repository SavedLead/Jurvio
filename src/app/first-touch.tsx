"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { FIRST_TOUCH_COOKIE, LAST_PUBLIC_PATH_COOKIE, isTrackablePublicPath } from "@/modules/growth/attribution";

/**
 * First-touch attribution on public pages only (auth routes send no-referrer).
 * Stores referrer host, landing path and utm tags in a first-party cookie and
 * reports the first visit once; remembers the last public path for sign-in.
 */
export function FirstTouch() {
  const pathname = usePathname();
  useEffect(() => {
    try {
      if (!pathname || !isTrackablePublicPath(pathname) || location.hostname.startsWith("z.")) return;
      const secure = location.protocol === "https:" ? "; Secure" : "";
      document.cookie = `${LAST_PUBLIC_PATH_COOKIE}=${encodeURIComponent(pathname.slice(0, 300))}; Path=/; SameSite=Lax${secure}`;
      if (document.cookie.split("; ").some((c) => c.startsWith(`${FIRST_TOUCH_COOKIE}=`))) return;
      let r: string | null = null;
      try { r = document.referrer ? new URL(document.referrer).hostname : null; } catch { r = null; }
      if (r === location.hostname) r = null;
      const q = new URLSearchParams(location.search);
      const ft = { r, l: pathname.slice(0, 300), us: q.get("utm_source"), um: q.get("utm_medium"), uc: q.get("utm_campaign"), t: Date.now() };
      const value = encodeURIComponent(JSON.stringify(ft));
      document.cookie = `${FIRST_TOUCH_COOKIE}=${value}; Path=/; Max-Age=${180 * 86400}; SameSite=Lax${secure}`;
      const body = JSON.stringify(ft);
      if (!navigator.sendBeacon?.("/api/visit", new Blob([body], { type: "application/json" }))) {
        void fetch("/api/visit", { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true });
      }
    } catch { /* attribution is best effort */ }
  }, [pathname]);
  return null;
}
