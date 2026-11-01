import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", () => ({ db: () => { throw new Error("db should not be used for the free hand-off"); } }));

const { POST } = await import("./route");

describe("POST /api/waitlist", () => {
  it("re-posts a free-plan choice from the shared pricing form to sign-in with a 307", async () => {
    const request = new NextRequest("http://localhost:3000/api/waitlist", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: "http://localhost:3000", host: "localhost:3000" },
      body: "plan=free&email=reader%40example.com&next=%2Faccount&company=",
    });
    const response = await POST(request);
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/api/auth/request");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("still rejects a free plan without an email", async () => {
    vi.resetModules();
    const request = new NextRequest("http://localhost:3000/api/waitlist", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", origin: "http://localhost:3000", host: "localhost:3000" },
      body: JSON.stringify({ plan: "free" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });
});
