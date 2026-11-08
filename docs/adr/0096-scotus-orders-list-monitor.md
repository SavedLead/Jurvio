# ADR 0096: Official Supreme Court orders-list monitor

Status: proposed. David Rosenberg approved starting this phase with free official
sources and no paid services (November 2026). This change does not deploy the
job and does not turn on subscriber mail.

## Context

Jurvio already polls Supreme Court dockets about every three hours, emergency
applications about every ten minutes, and enriched opinions about every twenty
minutes. Those jobs do not read the Court's orders-list PDFs. An orders list is
the document that denies review, grants review, enters summary dispositions, and
sometimes states a judgment, often with a separate writing attached. A cert
denial is not a decision on who was right. The docket feed can lag that PDF, and
it is not a coverage check for the orders index.

## Decision

1. Add a core-lane job, `scotus-orders-lists`, that reads only
   `https://www.supremecourt.gov/orders/ordersofthecourt/{term}` and the links
   labeled "Order List." Miscellaneous orders on the same page are ignored.
2. Keep the PDF as the source artifact. Entry text is pdftotext with line wraps
   joined. The official URL, content hash, index date, and printed date are
   stored. A date disagreement is kept, not guessed away.
3. Link an entry only when exactly one existing SCOTUS case has that docket
   number. No case is created. A caption is never used as an identity. Zero
   matches stay unlinked. Two matches stay ambiguous.
4. Classify from the entry's own text, with the section heading as the default
   when the entry is only a caption. Cert denial, cert grant, dismissal,
   summary disposition, merits judgment, procedural orders, and separate
   writings are different actions. A separate writing does not become the
   Court's ruling. Plain-English lines say what is known and what is not.
5. The sealed/restricted filter used by the emergency docket is not loosened.
   A matching entry is counted and its caption, text, and writings are not stored.
6. The same PDF hash is a duplicate. A new hash, or a second Order List URL for
   the same index date, is a new revision and supersedes the older row without
   deleting it. Identical entry text does not become a second notification.
7. Lists already on the index at the first successful read are backfill.
   `scotus_orders_list_entry.notify` is constrained to false, and backfilled
   rows cannot be marked notify. The job does not write `docket_entry` and does
   not call the alert senders. Mail stays off until a later reviewed change.
8. `scotus_orders_list_coverage` records run status and completeness separately.
   Succeeded means the index was read and this run stored what it could.
   Complete means every orders-list link currently on that term's index has
   stored text. Neither means every Court order is in Jurvio.
9. The job is small: at most eight requests, three PDFs, one request a second,
   eight-minute budget, on the existing core worker. HTTP 429 stops the run.
   `JURVIO_PAUSE_SCOTUS_ORDERS_LISTS=1` skips it. CourtListener nightly imports
   are unchanged.

## Alternatives

- **Wait for the docket JSON feed.** It does not distinguish an orders-list
  denial from a later merits opinion at the moment the list is posted, and a
  successful docket run does not say whether the orders index was read.
- **Parse miscellaneous orders in the same job.** Those are a different
  document series. This phase is orders lists only.
- **Create a draft case for every docket on the list.** That would guess a case
  record from an orders line before the docket feed has one, and it could
  duplicate the existing docket identity rules.
- **Turn on follower email for new lists.** The feed has not been reviewed in
  production. Backfill would also email people about old orders.

## Costs and risks

- pdftotext can wrap or drop a line. The PDF remains the source. A failed
  extraction stays incomplete and is retried; it is not reported as complete.
- The strict filter withholds some public lines that merely mention a redacted
  or sealed filing. That is the existing filter, applied to the whole entry.
- A singular order is attached only to the docket directly above it. A plural
  order is attached to the open group. An unusual singular order meant for
  several dockets would be stored only on the last of them.
- One term index is monitored per run. Earlier terms are not walked unless an
  operator passes `--term`.
- Reconsider if the Court stops labeling orders lists in the index HTML, if
  pdftotext is not available on the core worker, or if a reviewed notification
  change is ready to drop the `notify = false` check.

## Rollback

Set `JURVIO_PAUSE_SCOTUS_ORDERS_LISTS=1` on the core worker and restart that
worker. The tables can stay. Removing the job from `scripts/scheduler-jobs.ts`
stops it on the next deploy. Do not delete stored rows to roll back.
