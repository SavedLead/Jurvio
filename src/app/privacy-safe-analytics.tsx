"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { analyticsAllowedOnPath, analyticsPathTemplate } from "./analytics-policy";

declare global {
  interface Window {
    posthog?: {
      init: (key: string, options: Record<string, unknown>) => void;
      capture: (event: string, properties?: Record<string, unknown>) => void;
    };
  }
}

const enabled = process.env.NEXT_PUBLIC_POSTHOG_ENABLED === "true";
const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

export function PrivacySafeAnalytics() {
  const pathname = usePathname();
  const allowed = analyticsAllowedOnPath(pathname);
  const configured = Boolean(enabled && key);
  const [ready, setReady] = useState(false);
  const template = useMemo(() => analyticsPathTemplate(pathname), [pathname]);

  useEffect(() => {
    if (!ready || !configured || !allowed) return;
    window.posthog?.capture("public_page_view", {
      path_template: template,
      analytics_contract: "jurvio-posthog-v1",
    });
  }, [allowed, configured, ready, template]);

  if (!configured || !allowed) return null;

  return (
    <Script
      id="jurvio-posthog"
      src={`${host}/static/array.js`}
      strategy="afterInteractive"
      onLoad={() => {
        try {
          if (!window.posthog || !key) return;
          window.posthog.init(key, {
            api_host: host,
            capture_pageview: false,
            capture_pageleave: false,
            autocapture: false,
            disable_session_recording: true,
            person_profiles: "identified_only",
            mask_all_text: true,
            mask_all_element_attributes: true,
            respect_dnt: true,
            persistence: "memory",
            loaded: () => setReady(true),
          });
        } catch {
          // Visual analytics is best effort and must never affect Jurvio rendering.
        }
      }}
      onError={() => setReady(false)}
    />
  );
}
