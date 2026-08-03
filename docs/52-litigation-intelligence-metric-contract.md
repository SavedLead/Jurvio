# Litigation Intelligence metric contract

This contract governs every customer-visible Jurvio Litigation Intelligence answer.

## Required answer fields

Every result must show the direct answer, exact cohort, sample size, date and court coverage, metric definition, known exclusions, refresh time, quality level, and supporting cases or documents. Unknown facts remain unknown and are never converted to `false`, `denied`, or `0`.

Percentages must display the numerator, denominator, and unknown count. A metric without supporting evidence may be shown only as unavailable. Every evidence identifier must resolve to a published record the requesting user is permitted to view.

## Allowed automation

Deterministic queries may calculate counts, percentages, and durations from versioned canonical facts. A language model may translate a question into proposed filters or explain returned evidence, but cannot change identity, publication, legal status, or verified outcome facts.

## Prohibited claims

Jurvio must not claim that a judge will rule a particular way, present historical observation as legal advice, describe incomplete data as comprehensive, assign a lawyer or judge a simplistic win score, or imply citator-grade treatment before validated Citator coverage exists.

## Release gate

Litigation Intelligence remains behind authenticated beta access until benchmark answers are deterministic, every non-null metric links to evidence, coverage limitations are visible, and unauthorized or unpublished records cannot enter the evidence ledger.
