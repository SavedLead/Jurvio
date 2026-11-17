# Descriptions for emergency applications

Status: Proposed. Approved by David Rosenberg on 2026-11-17, including the
model and budget change the same day. Model text is labeled AI-generated.
Template text is not. Teasers are a preview only.

## Context

Emergency-application pages already explain each docket line with fixed
phrasing. David asked for a plain-English description of serious emergency
applications and federal-government applications, newest first. Routine
filings should not spend the credit. A later email to followers may tease a
description. That email is not approved, and charging stays off.

## Decision

- David picked `gpt-6-astra` ($10 / $50 per million tokens) for full
  descriptions. `gpt-6.1-sol` ($2 / $10) fills gaps after the Astra cap.
  `gpt-6-luna` is only for follower teasers. No teaser email is sent, and
  charging stays off.
- An extension of time, and a thin filing that is not a stay, injunction,
  vacatur, bail request, capital case, or federal application, gets a fixed
  template. Those rows record model `rule` and `ai_generated = false`.
- A followed case can get a one- or two-sentence teaser from `gpt-6-luna`.
  The page shows it as an email preview. The table cannot mark a teaser as
  sent. This change does not send mail and does not set `JURVIO_BILLING_LIVE`.
- Through 2026-12-05 the caps are $110 for Astra, $8 for Sol, $2 for teasers,
  and $118 in total. Description calls stop $2 short of the total so the
  teaser reserve remains. After that date the job spends nothing until
  `BRIEF_BUDGET_AFTER_TOP_USD`, `BRIEF_BUDGET_AFTER_MID_USD`,
  `BRIEF_BUDGET_AFTER_TEASER_USD`, and `BRIEF_BUDGET_AFTER_TOTAL_USD` are set.
- Each model call stores tokens and cost, including a rejected description.
  The prompt sees public docket lines only.

## Alternatives

- Use Astra for extensions too. Rejected: the pattern is fixed, and the
  credit is for descriptions that need judgment.
- Hide the full description until a $19 payment. Rejected: charging is not
  approved, and the description stays on the page.
- Keep spending after December 5 at the same caps. Rejected: the monthly
  credit is a new budget David will set, so the job stops until those four
  values are configured.

## Reconsideration

Revisit when David sets the post-December 5 caps, or when he approves the
follower email and a charge.
