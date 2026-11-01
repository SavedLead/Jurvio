import type { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_TTL_DAYS, SIGNED_IN_HINT_COOKIE } from "../domain/tokens";

function firstHost(value: string | null): string {
  return (value ?? "").split(",")[0]?.trim().toLowerCase() ?? "";
}

/** Rejects cross-site browser POSTs (CSRF). Requests with no Origin (mail clients' one-click unsubscribe, curl) pass. */
export function isSameOriginRequest(request: Pick<NextRequest, "headers">): boolean {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return request.headers.get("sec-fetch-site") !== "cross-site";
  let originHost: string;
  try { originHost = new URL(origin).host.toLowerCase(); } catch { return false; }
  const hosts = [firstHost(request.headers.get("x-forwarded-host")), firstHost(request.headers.get("host"))].filter(Boolean);
  return hosts.includes(originHost);
}

export function clientIp(request: Pick<NextRequest, "headers">): string {
  return request.headers.get("cf-connecting-ip")?.trim()
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || "unknown";
}

export function setSessionCookies(response: NextResponse, sessionToken: string) {
  const maxAge = SESSION_TTL_DAYS * 24 * 60 * 60;
  response.cookies.set(SESSION_COOKIE, sessionToken, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge });
  response.cookies.set(SIGNED_IN_HINT_COOKIE, "1", { httpOnly: false, secure: true, sameSite: "lax", path: "/", maxAge });
}

export function clearSessionCookies(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  response.cookies.set(SIGNED_IN_HINT_COOKIE, "", { httpOnly: false, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
}

export function noStore<T extends NextResponse>(response: T): T {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

/** Form posts expect a redirect; fetch() callers send Accept: application/json. */
export function wantsJson(request: Pick<NextRequest, "headers">): boolean {
  return (request.headers.get("accept") ?? "").includes("application/json")
    || (request.headers.get("content-type") ?? "").includes("application/json");
}

export async function readBody(request: NextRequest): Promise<Record<string, unknown>> {
  const type = request.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) {
      const body = await request.json();
      return body && typeof body === "object" ? body as Record<string, unknown> : {};
    }
    const form = await request.formData();
    return Object.fromEntries([...form.entries()].map(([key, value]) => [key, typeof value === "string" ? value : ""]));
  } catch {
    return {};
  }
}
