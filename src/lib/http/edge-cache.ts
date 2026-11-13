// Edge (Cloudflare) cache policy for anonymous visitors on public pages.
//
// Every page is `force-dynamic`, so Next sends `private, no-cache, no-store`
// unless something sets Cache-Control first. The middleware calls
// `publicEdgeCacheControl()` and, only when it returns a value, sets that
// header on the response; Next keeps a Cache-Control that is already present.
//
// Safety rules (all must hold, otherwise the Next default stays in place):
// * host is the public site (never the z.jurvio.com command center);
// * GET or HEAD;
// * no session / auth / preview cookie and no Authorization or Cloudflare
//   Access assertion header;
// * not a React Server Components / server-action request (Cloudflare ignores
//   `Vary`, so RSC payloads must never share a cache entry with HTML).
//   NOTE: Next strips the flight headers (`rsc`, `next-router-*`) and the `_rsc`
//   query param before middleware runs, so in production these checks are a
//   belt-and-braces guard only. The authoritative RSC exclusion is the
//   Cloudflare Cache Rule, which never makes requests carrying an `rsc` header
//   or an `_rsc` query param cache-eligible;
// * the path is on the public allowlist below. Free-text listing filters
//   (`q`, `party`, `firm`) and /search stay uncached on purpose.
//
// The Cloudflare Cache Rule mirrors the cookie and path exclusions so the two
// layers agree; the origin header remains the source of truth for TTLs.

// One hour fresh, then a day of stale-while-revalidate. Cloudflare can answer
// from the edge immediately and refresh in the background, instead of making
// the visitor wait on the origin once the previous 15-minute window expires.
export const PUBLIC_EDGE_CACHE_CONTROL = "public, s-maxage=3600, stale-while-revalidate=86400";

// Customer sessions (jurvio_session) are listed too: subscriber-only case
// records render their full content for paid customers, so no response to a
// request carrying a customer session may be stored in the shared cache.
// (Signed-in customers can still be served anonymous HITs; the subscriber gate
// then reloads with ?subscriber=1, which is never cacheable.)
// /account, /signin and /api/* are never on the allowlist below.
export const AUTH_COOKIE_NAMES = [
  "jurvio_session", // customer session (accounts SESSION_COOKIE)
  "jurvio_admin_session", // hosted internal session (INTERNAL_SESSION_COOKIE)
  "CF_Authorization", // Cloudflare Access session
  "__prerender_bypass", // Next draft mode
  "__next_preview_data",
] as const;

const PRIVATE_REQUEST_HEADERS = [
  "authorization",
  "cf-access-jwt-assertion",
  "rsc",
  "next-router-prefetch",
  "next-router-state-tree",
  "next-router-segment-prefetch",
  "next-action",
  "next-url",
] as const;

const PUBLIC_HOSTS = new Set(["jurvio.com", "www.jurvio.com"]);

const PUBLIC_EXACT_PATHS = new Set([
  "/",
  "/cases",
  "/supreme-court",
  "/scotus",
  "/coverage",
  "/robots.txt",
  "/sitemap.xml",
  "/llms.txt",
  "/attorneys",
  "/us-attorneys",
  // static and legal pages
  "/contact",
  "/corrections",
  "/editorial-standards",
  "/methodology",
  "/privacy",
  "/public-records-policy",
  "/terms",
  // Same HTML for everyone; signed-in state and waitlist buttons load in the browser.
  "/pricing",
]);

// Matches the prefix itself and anything below it.
const PUBLIC_PATH_PREFIXES = [
  "/case",
  "/judges",
  "/courts",
  "/parties",
  "/law-firms",
  "/explainers",
  "/supreme-court",
  "/government-litigation",
  "/sitemaps",
  // Topic pages: same HTML for everyone; the Follow button loads its state in the browser.
  "/topics",
  "/feeds",
] as const;

// /cases filters that carry visitor-typed free text. Kept live (never cached).
const CASES_FREE_TEXT_PARAMS = ["q", "party", "firm"] as const;

export interface EdgeCacheRequest {
  method: string;
  hosts: ReadonlySet<string>;
  pathname: string;
  searchParams: URLSearchParams;
  headers: Headers;
}

export function cookieNames(cookieHeader: string | null): string[] {
  if (!cookieHeader) return [];
  return cookieHeader.split(";").map((item) => item.split("=")[0]?.trim() ?? "").filter(Boolean);
}

export function hasAuthCookie(cookieHeader: string | null): boolean {
  const names = cookieNames(cookieHeader);
  return names.some((name) => (AUTH_COOKIE_NAMES as readonly string[]).includes(name));
}

/** Query flag the subscriber gate adds so a paid customer's view is always rendered at the origin. */
export const SUBSCRIBER_VIEW_PARAM = "subscriber";

// Never shared, even for anonymous visitors: Cloudflare serves a cached copy to
// signed-in visitors too, so a page whose content depends on the viewer's plan
// must always render at the origin (the Pro analytics page vs. its teaser).
const PRIVATE_PATH_PREFIXES = ["/supreme-court/emergency/analytics"] as const;

export function isPublicCacheablePath(pathname: string, searchParams: URLSearchParams): boolean {
  if (searchParams.has("_rsc")) return false;
  if (PRIVATE_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return false;
  if (searchParams.has(SUBSCRIBER_VIEW_PARAM)) return false;
  if (pathname === "/cases") {
    return CASES_FREE_TEXT_PARAMS.every((name) => !(searchParams.get(name) ?? "").trim());
  }
  if (PUBLIC_EXACT_PATHS.has(pathname)) return true;
  return PUBLIC_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function publicEdgeCacheControl(request: EdgeCacheRequest): string | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const hosts = [...request.hosts].filter(Boolean);
  if (hosts.length === 0 || !hosts.every((host) => PUBLIC_HOSTS.has(host))) return null;
  if (PRIVATE_REQUEST_HEADERS.some((name) => request.headers.has(name))) return null;
  if (hasAuthCookie(request.headers.get("cookie"))) return null;
  if (!isPublicCacheablePath(request.pathname, request.searchParams)) return null;
  return PUBLIC_EDGE_CACHE_CONTROL;
}
