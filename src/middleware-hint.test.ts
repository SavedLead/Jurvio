import { NextRequest, NextResponse } from "next/server";
import { describe, expect, it } from "vitest";
import * as tokens from "@/modules/accounts/domain/tokens";
import { SESSION_COOKIE, SESSION_TTL_DAYS, SIGNED_IN_HINT_COOKIE, syncSignedInHint } from "./middleware";

function run(cookie: string) {
  const request = new NextRequest("https://jurvio.com/supreme-court/emergency", { headers: cookie ? { cookie } : {} });
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "public, s-maxage=300");
  syncSignedInHint(request, response);
  return response;
}

describe("signed-in hint cookie kept in step with the session", () => {
  it("uses the accounts cookie names", () => {
    expect(SESSION_COOKIE).toBe(tokens.SESSION_COOKIE);
    expect(SIGNED_IN_HINT_COOKIE).toBe(tokens.SIGNED_IN_HINT_COOKIE);
    expect(SESSION_TTL_DAYS).toBe(tokens.SESSION_TTL_DAYS);
  });

  it("adds the hint for a session without one, on a private response", () => {
    const response = run("jurvio_session=abc");
    expect(response.cookies.get("jurvio_signed_in")?.value).toBe("1");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("clears a hint left without a session", () => {
    const response = run("jurvio_signed_in=1");
    expect(response.cookies.get("jurvio_signed_in")?.value).toBe("");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("leaves matching cookies and anonymous visitors alone", () => {
    for (const cookie of ["", "jurvio_session=abc; jurvio_signed_in=1", "other=1"]) {
      const response = run(cookie);
      expect(response.cookies.get("jurvio_signed_in")).toBeUndefined();
      expect(response.headers.get("Cache-Control")).toBe("public, s-maxage=300");
    }
  });
});
