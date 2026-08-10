# ADR: Jurisdiction-and-timeframe-first federal judge matching

## Decision

Judge Autopilot builds its candidate universe from judges with a verified service term in the case court on the relevant date. It then ranks source-observed names only within that universe. Exact names and uniquely compatible initials may be accepted deterministically. Ties, surname-only matches, visiting-judge gaps, and other ambiguity remain review-only.

## Why

The roster and service timeline are stronger identity constraints than global name guessing. This also makes the decision reproducible and preserves a clear explanation for every candidate.

## Alternatives

- Global fuzzy matching was rejected because common surnames and initials create false identities.
- Exact-name-only matching was replaced because it leaves resolvable initials unmatched.
- AI identity selection was rejected because identity and publication decisions must remain deterministic and source-backed.

## Benefits, costs, and risks

Benefits are higher recall, bounded candidate sets, explainable scores, and safe automatic acceptance. Costs are additional roster queries and continued review for visiting or incomplete assignment records. The primary risk is an incomplete service timeline; the system mitigates it by refusing to force low-confidence matches.

## Reconsideration trigger

Revisit scoring only after a labeled validation set demonstrates measured precision and recall, or after official assignment and visiting-judge sources materially improve candidate eligibility.
