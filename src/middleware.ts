import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { NOINDEX_HEADER_VALUE, sitePubliclyLaunched } from "@/lib/seo/indexing";

const COMMAND_CENTER_HOST = "z.jurvio.com";
const PUBLIC_HOSTS = new Set(["jurvio.com", "www.jurvio.com"]);

// Force noindex on every response until the site is explicitly launched. This
// is the header half of the pre-launch lockdown (the meta half lives in page
// metadata via robotsFor). Applied to all hosts/paths — a noindex header on API
// or health-check responses does not affect their status codes or bodies.
function withLockdownHeaders(response: NextResponse): NextResponse {
  if (!sitePubliclyLaunched()) {
    response.headers.set("X-Robots-Tag", NOINDEX_HEADER_VALUE);
  }
  return response;
}

function requestHost(request: NextRequest) {
  const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  const firstHost = forwardedHost.split(",").at(0)?.trim() ?? "";
  return firstHost.split(":").at(0)?.toLowerCase() ?? "";
}

function isFrameworkOrAssetPath(pathname: string) {
  return (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/api/") ||
    pathname === "/favicon.ico" ||
    /\.[^/]+$/.test(pathname)
  );
}

function publicCommandCenterPath(pathname: string) {
  if (pathname === "/internal") return "/";
  if (pathname.startsWith("/internal/")) return pathname.slice("/internal".length);
  return null;
}

export function middleware(request: NextRequest) {
  const host = requestHost(request);
  const { pathname } = request.nextUrl;

  if (host === COMMAND_CENTER_HOST) {
    const cleanPath = publicCommandCenterPath(pathname);
    if (cleanPath !== null) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = cleanPath;
      return withLockdownHeaders(NextResponse.redirect(redirectUrl, 308));
    }

    if (isFrameworkOrAssetPath(pathname)) return withLockdownHeaders(NextResponse.next());

    const rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname = pathname === "/" ? "/internal" : `/internal${pathname}`;
    return withLockdownHeaders(NextResponse.rewrite(rewriteUrl));
  }

  if (PUBLIC_HOSTS.has(host) && (pathname === "/internal" || pathname.startsWith("/internal/"))) {
    return new NextResponse(null, {
      status: 404,
      headers: {
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    });
  }

  return withLockdownHeaders(NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
