# Visual product analytics policy

Jurvio uses first-party `demand_event` records as the durable source for legal-content demand and bot separation. PostHog is an optional visual layer for aggregate funnels built from explicitly selected, templated events.

## Production controls

PostHog remains fully disabled unless `NEXT_PUBLIC_POSTHOG_ENABLED=true` and `NEXT_PUBLIC_POSTHOG_KEY` are both present. Removing the switch or setting it to `false` is the kill switch and does not affect rendering, ingestion, publication, or first-party events.

Only explicitly named, templated events are captured. Autocapture, arbitrary page text, element attributes, persistent browser identity, and session replay are disabled. Configure a PostHog hard billing limit before enabling it.

Analytics is not initialized on internal, authentication, account, settings, billing, correction, or privacy-request routes. Browser Do Not Track is respected. Analytics failures are best effort and cannot block a route.

## Approved roadmap hypotheses

Public legal records and readable court text remain free. Proposed Plus ($29), Professional ($99), and Team ($299) tiers are hypotheses to validate through registration, follow, alert-channel, pricing, and upgrade-interest events before product enforcement.

The future SCOTUS alert proposition is “Get notified when the Supreme Court acts.” Demand measurement must distinguish single-case follows, opinions, orders, briefs, argument scheduling, transcript/audio, corrections, and every-release interest. Prelaunch controls must clearly identify themselves as interest collection and must never imply alerts are already being delivered.
