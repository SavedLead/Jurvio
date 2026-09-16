import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { NOINDEX_HEADER_VALUE, sitePubliclyLaunched } from "@/lib/seo/indexing";

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
  return withLockdownHeaders(NextResponse.next());
}
export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
