import { describe, expect, it } from "vitest";
import { ResendEmailProvider, emailConfigured, escapeHtml, getEmailProvider } from "./email";

describe("email provider", () => {
  it("is not configured without both RESEND_API_KEY and EMAIL_FROM", () => {
    expect(emailConfigured({})).toBe(false);
    expect(emailConfigured({ RESEND_API_KEY: "re_x" })).toBe(false);
    expect(emailConfigured({ EMAIL_FROM: "Jurvio <alerts@jurvio.com>" })).toBe(false);
    expect(getEmailProvider({ RESEND_API_KEY: " ", EMAIL_FROM: "a@b.com" })).toBeNull();
    expect(getEmailProvider({ RESEND_API_KEY: "re_x", EMAIL_FROM: "a@b.com" })?.name).toBe("resend");
  });

  it("posts to the Resend API and reports the message id", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const provider = new ResendEmailProvider("re_test", "Jurvio <alerts@jurvio.com>", async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: "msg_1" }), { status: 200 });
    });
    const result = await provider.send({ to: "a@example.com", subject: "S", text: "T", html: "<p>T</p>", tag: "signin_link" });
    expect(result).toEqual({ ok: true, providerMessageId: "msg_1" });
    expect(calls[0]!.url).toBe("https://api.resend.com/emails");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ from: "Jurvio <alerts@jurvio.com>", to: ["a@example.com"], subject: "S" });
  });

  it("returns an error without throwing when Resend rejects", async () => {
    const provider = new ResendEmailProvider("re_test", "a@b.com", async () => new Response(JSON.stringify({ name: "validation_error" }), { status: 422 }));
    expect(await provider.send({ to: "a@example.com", subject: "S", text: "T", html: "T" })).toEqual({ ok: false, error: "resend 422: validation_error" });
  });

  it("escapes html", () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
  });
});
