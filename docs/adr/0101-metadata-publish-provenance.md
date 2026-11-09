# Keep metadata publishing moving after the sourced drafts run out

Status: Accepted for the Nov 9, 2026 publishing approval.

## Context

On Nov 9 the public case count rose by about 14,600 in the first cycles after
`bc002ad`, then by about 13. The 12-minute publisher walks drafts in
`created_at` order and publishes only when the court row is verified and the
source artifact has an http URL, a sha256 checksum, and a retrieval time.
Anything else is written to `federal_publication_hold` and skipped on the next
cycle. The first slice of drafts still had that source record. The drafts
behind it do not, so the qualifying pool went dry and later cycles held cases
instead of publishing them.

That is stricter than the publishing rules: a case may be displayable without
an opinion, thick cases come first, and a case filed in the last 90 days may
publish with no docket lines. Sealed text stays off the site. A slow public
search still shrinks or stops a cycle.

## Decision

While metadata publication is on, those source and court-verification gaps are
not a hold. The publisher reopens an existing hold when every reason on it is
one of: missing opinion text, unverified court, missing source artifact,
missing source URL, invalid checksum, missing retrieval time. A sealed case, a
docket collision, a missing caption or docket, or a non-federal court stays
held. The hourly pass still ranks the cases it loaded thickest first, then the
last 90 days, then thin pre-2000 cases, and it uses the same waiver.

## Alternatives considered

- Leave the holds and wait for every draft to grow a checksum. Rejected: bulk
  and feed rows often have a caption and docket and no raw artifact, so the
  count would stay flat.
- Bump the publication rule version so every hold is forgotten. Rejected: that
  would also retry sealed and collision holds.

## Benefits

Publishing continues through the drafts that have a caption and docket at a
federal court, including cases with no opinion and new cases with no docket
lines.

## Costs and risks

Some published rows have no source URL on the page. They are displayable and
not indexable when they have no opinion text. The search slowdown is unchanged.
A metadata publish still does not change `legal_case.updated_at`.

## Reconsideration trigger

Revisit if sealed or colliding cases appear on the public site, or if a cycle
stops because the candidate query exceeds its statement timeout.

## Rollout

The next production release. `JURVIO_PAUSE_FEDERAL_METADATA=1` returns the
12-minute publisher to the strict source checks. `JURVIO_PAUSE_FEDERAL_PUBLICATION=1`
stops that publisher entirely.
