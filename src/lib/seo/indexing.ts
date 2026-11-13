import type { Metadata } from "next";

// Pre-launch indexing lockdown.
//
// Until the site is explicitly launched (JURVIO_PUBLIC_LAUNCH === "true"), the
// entire public site is forced to noindex/nofollow through BOTH channels search
// engines honor: an X-Robots-Tag response header (applied site-wide in
// middleware) and per-page <meta name="robots"> metadata (robotsFor below).
// The default — env unset or anything other than "true" — is locked down, so
// indexing can never be enabled by accident. Flipping JURVIO_PUBLIC_LAUNCH to
// "true" is the single switch that opens the site for indexing at launch.
export function sitePubliclyLaunched(): boolean {
  return process.env.JURVIO_PUBLIC_LAUNCH === "true";
}

// Value used for the X-Robots-Tag header and any route-level header handling.
export const NOINDEX_HEADER_VALUE =
  "noindex, nofollow, noarchive, nosnippet, noimageindex";

const LOCKED_DOWN_ROBOTS: Metadata["robots"] = {
  index: false,
  follow: false,
  nocache: true,
  googleBot: { index: false, follow: false, noimageindex: true },
};

// Page-level robots metadata. While locked down every page reports
// noindex/nofollow regardless of its intended post-launch indexability; after
// launch it honors `indexWhenLaunched`.
/** Exact robots policy for a page whose rendered text had a name redacted. */
export const REDACTED_ROBOTS_CONTENT = "noindex, noarchive, nosnippet";

export function robotsFor(indexWhenLaunched: boolean, redacted = false): Metadata["robots"] {
  if (redacted) return REDACTED_ROBOTS_CONTENT;
  if (!sitePubliclyLaunched()) return LOCKED_DOWN_ROBOTS;
  return indexWhenLaunched ? { index: true, follow: true } : { index: false, follow: true };
}
