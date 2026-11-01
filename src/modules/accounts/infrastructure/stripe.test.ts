import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { billingConfig, checkoutEnabled, createCheckoutSession, planForPrice, verifyStripeSignature } from "./stripe";

describe("stripe scaffolding", () => {
  it("is disabled without STRIPE_SECRET_KEY and needs a webhook secret + price per plan", () => {
    const off = billingConfig({});
    expect(off.enabled).toBe(false);
    expect(checkoutEnabled(off, "plus")).toBe(false);
    const partial = billingConfig({ STRIPE_SECRET_KEY: "sk_test_x", STRIPE_PRICE_PLUS: "price_plus" });
    expect(checkoutEnabled(partial, "plus")).toBe(false);
    const on = billingConfig({ STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_x", STRIPE_PRICE_PLUS: "price_plus" });
    expect(checkoutEnabled(on, "plus")).toBe(true);
    expect(checkoutEnabled(on, "pro")).toBe(false);
    expect(checkoutEnabled(on, "free")).toBe(false);
    expect(planForPrice(on, "price_plus")).toBe("plus");
    expect(planForPrice(on, "price_other")).toBeNull();
  });

  it("verifies Stripe-Signature v1 within tolerance", () => {
    const payload = JSON.stringify({ id: "evt_1" });
    const t = 1_800_000_000;
    const sig = createHmac("sha256", "whsec_test").update(`${t}.${payload}`).digest("hex");
    expect(verifyStripeSignature(payload, `t=${t},v1=${sig}`, "whsec_test", t)).toBe(true);
    expect(verifyStripeSignature(payload, `t=${t},v1=${sig}`, "whsec_other", t)).toBe(false);
    expect(verifyStripeSignature(`${payload} `, `t=${t},v1=${sig}`, "whsec_test", t)).toBe(false);
    expect(verifyStripeSignature(payload, `t=${t},v1=${sig}`, "whsec_test", t + 301)).toBe(false);
    expect(verifyStripeSignature(payload, null, "whsec_test", t)).toBe(false);
  });

  it("creates a subscription Checkout session tied to the user", async () => {
    let sent: URLSearchParams | null = null;
    const url = await createCheckoutSession({
      secretKey: "sk_test_x", priceId: "price_plus", userId: "u1", email: "a@example.com",
      successUrl: "https://jurvio.com/account", cancelUrl: "https://jurvio.com/pricing",
      fetchImpl: async (_url, init) => { sent = new URLSearchParams(String(init.body)); return new Response(JSON.stringify({ url: "https://checkout.stripe.com/c/1" })); },
    });
    expect(url).toBe("https://checkout.stripe.com/c/1");
    expect(sent!.get("mode")).toBe("subscription");
    expect(sent!.get("client_reference_id")).toBe("u1");
    expect(sent!.get("customer_email")).toBe("a@example.com");
    expect(sent!.get("line_items[0][price]")).toBe("price_plus");
  });
});
