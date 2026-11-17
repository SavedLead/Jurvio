# Stripe stays in test mode until live charging is switched on

Status: Proposed. This does not create Stripe products or accept live charges.

## Context

Checkout, the customer portal, and subscription webhooks already project a
Stripe subscription into `account_subscription`. A free account can follow
individual cases. Following a judge, court, party, topic, or the Supreme Court
emergency docket covers many cases.

## Decision

- Those five follow types require Plus, Pro, or Team. A free click shows an
  upgrade prompt and does not create an active follow. Existing free
  emergency-docket follows are kept and marked `needs_upgrade`.
- A follow of one case stays on Free and keeps its priority refresh.
- `JURVIO_BILLING_LIVE` must be exactly `1` before an `sk_live_` key or a
  live-mode webhook can change an entitlement. The default is off. Test keys
  (`sk_test_`) can run Checkout while the flag is off.
- This change does not call Stripe to create products or prices.

## Alternatives

- Leave emergency-docket follows on Free. Rejected: David set that follow as paid.
- Turn checkout on whenever any secret key is present. Rejected: a live key
  would start charging without a separate switch.

## Reconsideration

Revisit when David approves live prices and sets `JURVIO_BILLING_LIVE=1`
with live keys created in the Stripe dashboard, not in this repository.
