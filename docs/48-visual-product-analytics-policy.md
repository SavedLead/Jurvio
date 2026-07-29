# Visual product analytics policy

Jurvio uses first-party `demand_event` records as the durable source for legal-content demand and bot separation. PostHog is an optional visual layer for aggregate funnels, constrained click heatmaps, reading behavior, and sampled privacy-masked replay.

## Production controls

PostHog remains fully disabled unless `NEXT_PUBLIC_POSTHOG_ENABLED=true` and `NEXT_PUBLIC_POSTHOG_KEY` are both present. Removing the switch or setting it to `false` is the kill switch and does not affect rendering, ingestion, publication, or first-party events.

Only explicitly named page-view events and narrowly constrained public clicks are captured. Arbitrary page text and element attributes are not sent. All form inputs are masked. Replay is sampled at 5% by default and capped at 10% in code. Configure the PostHog project for short replay retention and a hard billing limit before enabling it.

Analytics is not initialized on internal, authentication, account, settings, billing, correction, or privacy-request routes. Browser Do Not Track is respected. Analytics failures are best effort and cannot block a route.

## Approved roadmap hypotheses

Public legal records and readable court text remain free. Proposed Plus ($29), Professional ($99), and Team ($299) tiers are hypotheses to validate through registration, follow, alert-channel, pricing, and upgrade-interest events before product enforcement.

The future SCOTUS alert proposition is “Get notified when the Supreme Court acts.” Demand measurement must distinguish single-case follows, opinions, orders, briefs, argument scheduling, transcript/audio, corrections, and every-release interest. Prelaunch controls must clearly identify themselves as interest collection and must never imply alerts are already being delivered.
