import { describe, expect, it } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET } from "./route";
import { clearSessionCookies, setSessionCookies } from "@/modules/accounts/http/request";

function request(cookie?: string) {
  return new NextRequest("https://jurvio.com/api/auth/session-hint", { headers: cookie ? { cookie } : {} });
}

describe("GET /api/auth/session-hint", () => {
  it("sets the signed-in hint when a session cookie is present", async () => {
    const response = GET(request("jurvio_session=abc"));
    expect(await response.json()).toEqual({ signedIn: true });
    const hint = response.cookies.get("jurvio_signed_in");
    expect(hint?.value).toBe("1");
    expect(hint?.httpOnly).toBeFalsy();
    expect(hint?.maxAge).toBe(30 * 24 * 60 * 60);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("clears a stale hint when there is no session", async () => {
    const response = GET(request("jurvio_signed_in=1"));
    expect(await response.json()).toEqual({ signedIn: false });
    expect(response.headers.get("set-cookie")).toMatch(/jurvio_signed_in=;.*Max-Age=0/i);
  });
});

describe("sign-in cookies", () => {
  it("magic-link verify sets the session and the hint together", () => {
    const response = NextResponse.redirect("https://jurvio.com/account", 303);
    setSessionCookies(response, "token");
    expect(response.cookies.get("jurvio_session")?.httpOnly).toBe(true);
    expect(response.cookies.get("jurvio_signed_in")?.value).toBe("1");
    expect(response.cookies.get("jurvio_signed_in")?.maxAge).toBe(response.cookies.get("jurvio_session")?.maxAge);
  });

  it("sign-out clears both", () => {
    const response = NextResponse.redirect("https://jurvio.com/", 303);
    clearSessionCookies(response);
    expect(response.cookies.get("jurvio_session")?.maxAge).toBe(0);
    expect(response.cookies.get("jurvio_signed_in")?.maxAge).toBe(0);
  });
});
