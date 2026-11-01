# ADR 0083: Customer accounts with passwordless email sign-in, follows and plans

**Status:** Accepted (David Rosenberg, 2026-11-01)

## Decision

- Customer sign-in is Jurvio's own passwordless email magic link. This supersedes the
  WorkOS AuthKit recommendation in docs/16 section 2 for Phase 1. No passwords are stored.
- Magic-link tokens: 32 random bytes, stored only as SHA-256 hashes, single use, 15-minute
  expiry. Opening the link shows a confirm button (POST) so mail scanners that prefetch
  links cannot consume the token.
- Sessions: random token in an httpOnly, Secure, SameSite=Lax cookie (`jurvio_session`),
  hashed in `auth_session`, 30 days, revocable on sign-out. A non-secret `jurvio_signed_in=1`
  hint cookie lets cached pages show "Account" instead of "Sign in" client-side.
- Sign-in requests are rate limited per hashed email and per hashed IP.
- Plans (Free / Plus $19 / Pro $59 / Team $199 for 5 seats) and their follow limits and alert
  cadence live in one config file, `src/modules/accounts/domain/plans.ts`.
- Email goes through a provider interface with a Resend implementation configured by
  `RESEND_API_KEY` and `EMAIL_FROM`; with no provider, production shows "sign-in temporarily
  unavailable" and development logs the link server-side.
- Stripe stays billing authority and is disabled until `STRIPE_SECRET_KEY` is set; the
  `account_subscription` row is Jurvio's product-access projection (docs/16 section 5).
- Accounts are never seeded by migrations (unlike 0101's admin bootstrap).

## Alternatives

WorkOS/Auth0/Clerk (managed, cost and vendor dependence; reconsider for SSO/SCIM or Team
plans), passwords (credential-stuffing and reset burden).

## Risks and reconsideration trigger

Email deliverability becomes the login dependency; reconsider when Team/SSO ships or if
magic-link abuse appears in `email_event`/`auth_rate_limit`.
