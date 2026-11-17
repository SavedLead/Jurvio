# AI descriptions for emergency applications

Status: Proposed. Approved by David Rosenberg on 2026-11-17. Descriptions are
labeled AI-generated and are not court findings.

## Context

Emergency-application pages already explain each docket line with fixed
phrasing. David asked for a plain-English description of every emergency
application, with federal-government applications first, written from the
application, the response, the lower-court ruling, and the Court's order.

## Decision

- `gpt-6.1-sol` ($2 / $10 per million input / output tokens) writes the full
  description for every application that is not a routine extension.
- `gpt-6-luna` ($0.10 / $0.50) writes one sentence for extension requests.
- The model sees public docket lines only. Lines matching the sealed /
  restricted filter are withheld, and a description that comes back matching
  that filter is not stored.
- Each stored description records the model, prompt version `emergency-brief-v1`,
  a hash of the prompt, token counts, and cost. It is rewritten when the
  filing count, latest filing date, status, withheld-line count, or prompt
  version changes.
- The backfill stops before a call that would take stored spend over $100.
  Spend is the sum of `scotus_brief_call`, including rejected outputs, so a
  rejected call is not free and is not retried until the docket changes.
- The job runs on the builder from `write-emergency-briefs-once.yml`. The
  public site reads the stored text and does not call OpenAI.

## Alternatives

- One model for extensions and serious applications. Rejected: 541 extension
  requests do not need the stronger model, and the cheap model keeps the
  backfill inside the cap.
- Regenerate whenever `changed_at` moves. Rejected: the live poll updates
  `changed_at` even when no filing arrived, which would repeat the spend.
- Run the model on the web host. Rejected: the web host stays free of this
  batch, and the key is not required to render a page.

## Reconsideration

Revisit the model ids or the $100 cap when OpenAI prices change, or when the
stored descriptions are wrong often enough that a prompt change is worth a
new version and a fresh spend.
