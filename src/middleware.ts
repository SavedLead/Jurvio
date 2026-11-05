import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { NOINDEX_HEADER_VALUE, sitePubliclyLaunched } from "@/lib/seo/indexing";
import { publicEdgeCacheControl } from "@/lib/http/edge-cache";

// Same values as modules/accounts/domain/tokens.ts (which uses node:crypto, so
// the edge middleware cannot import it); middleware-hint.test.ts keeps them equal.
export const SESSION_COOKIE = "jurvio_session";
export const SIGNED_IN_HINT_COOKIE = "jurvio_signed_in";
export const SESSION_TTL_DAYS = 30;

const COMMAND_CENTER_HOST = "z.jurvio.com";
const PUBLIC_HOSTS = new Set(["jurvio.com", "www.jurvio.com"]);

function withLockdownHeaders(response: NextResponse): NextResponse {
  if (!sitePubliclyLaunched()) response.headers.set("X-Robots-Tag", NOINDEX_HEADER_VALUE);
  return response;
}
// The command center serves live, per-request, authenticated data and its own
// navigation chrome. It must never be edge- or browser-cached, or a stale sidebar
// (e.g. missing a newly shipped page) and stale numbers get served after a deploy.
function commandCenterResponse(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store, must-revalidate");
  return withLockdownHeaders(response);
}
function normalizedHost(value: string | null) {
  const firstHost = (value ?? "").split(",").at(0)?.trim() ?? "";
  return firstHost.split(":").at(0)?.toLowerCase() ?? "";
}
function requestHosts(request: NextRequest) {
  return new Set([
    normalizedHost(request.headers.get("host")),
    normalizedHost(request.headers.get("x-forwarded-host")),
  ]);
}
function isFrameworkOrAssetPath(pathname: string) {
  return pathname.startsWith("/_next/") || pathname.startsWith("/api/") ||
    pathname === "/favicon.ico" || /\.[^/]+$/.test(pathname);
}
function legacyCommandCenterPath(pathname: string) {
  if (pathname === "/internal") return "/";
  if (pathname.startsWith("/internal/")) return pathname.slice("/internal".length);
  return null;
}

function isPrivatePublicHostPath(pathname: string) {
  return [
    "/login",
    "/change-password",
    "/internal",
    "/in",
    "/heartbeat",
    "/preview",
  ].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)) ||
    pathname.startsWith("/api/internal-auth/");
}

/**
 * The header's "Sign in" / "Account" link reads the non-HttpOnly hint cookie.
 * Keep it in step with the session cookie: a session with no hint (set before
 * the hint existed, or the hint was cleared) gets one; a hint with no session
 * is cleared. Only ever on responses that are not shared-cached.
 */
export function syncSignedInHint(request: Pick<NextRequest, "cookies">, response: NextResponse) {
  const session = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  const hint = request.cookies.get(SIGNED_IN_HINT_COOKIE)?.value === "1";
  if (session === hint) return;
  response.headers.set("Cache-Control", "private, no-store");
  response.cookies.set(SIGNED_IN_HINT_COOKIE, session ? "1" : "", {
    httpOnly: false, secure: true, sameSite: "lax", path: "/", maxAge: session ? SESSION_TTL_DAYS * 24 * 60 * 60 : 0,
  });
}

export function middleware(request: NextRequest) {
  const hosts = requestHosts(request);
  const { pathname } = request.nextUrl;
  if (hosts.has(COMMAND_CENTER_HOST)) {
    const canonicalPath = legacyCommandCenterPath(pathname);
    if (canonicalPath !== null) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = canonicalPath;
      return withLockdownHeaders(NextResponse.redirect(redirectUrl, 308));
    }
    if (pathname === "/in" || pathname.startsWith("/in/")) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = pathname === "/in" ? "/" : pathname.slice("/in".length);
      return commandCenterResponse(NextResponse.redirect(redirectUrl, 308));
    }
    if (
      pathname === "/login" ||
      pathname === "/change-password" ||
      pathname.startsWith("/api/internal-auth/") ||
      pathname === "/heartbeat" ||
      isFrameworkOrAssetPath(pathname)
    ) return withLockdownHeaders(NextResponse.next());

    const rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname = pathname === "/" ? "/internal" : `/internal${pathname}`;
    return commandCenterResponse(NextResponse.rewrite(rewriteUrl));
  }

  if ([...hosts].some((host) => PUBLIC_HOSTS.has(host)) && isPrivatePublicHostPath(pathname)) {
    return new NextResponse(null, {
      status: 404,
      headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow, noarchive" },
    });
  }
  const response = NextResponse.next();
  // Anonymous visitors on allowlisted public pages get a shared-cache header so
  // Cloudflare can serve them; everything else keeps Next's private default.
  const edgeCacheControl = publicEdgeCacheControl({
    method: request.method,
    hosts,
    pathname,
    searchParams: request.nextUrl.searchParams,
    headers: request.headers,
  });
  if (edgeCacheControl) response.headers.set("Cache-Control", edgeCacheControl);
  syncSignedInHint(request, response);
  const locked = withLockdownHeaders(response);
  // Cited-case stubs (ADR 0090, C9) are never indexed, even after launch.
  if (sitePubliclyLaunched() && pathname.startsWith("/cited/")) locked.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return locked;
}
export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
