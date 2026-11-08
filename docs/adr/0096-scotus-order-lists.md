# Official Supreme Court order lists

Status: Proposed. This change does not publish cases, clear holds, or send alerts.

## Context

The Court posts cert denials, grants, and merits dispositions on order-list PDFs,
separate from the slip-opinion index and from each case's docket JSON. An amended
list is a second PDF. Opinions relating to orders can have a later revised PDF.
Jurvio's docket and emergency lanes do not read that index. Putting those lines
into `docket_entry` would make a backfill look like new activity to subscriber alerts.

## Decision

Parse the public orders index and order-list text into `scotus_order_list` and
`scotus_order_list_item`.

- A denial of certiorari stays `cert_denied`. A grant that vacates or remands is
  `merits_disposition`.
- A would-grant, dissent, statement, or recusal is its own row.
- An amended PDF is a second list. A relating-to-orders revision keeps both URLs.
- Sealed or restricted lines are counted and not stored.
- The ingest does not write `docket_entry`, `direct_court_event`, or alert tables.
- PDF checksums are stored only from bytes that were fetched.

The dry-run workflow fetches the public index and prints a coverage report. It
does not write. Applying the load waits until migration 0201 is deployed and is
not part of this workflow.

## Alternatives considered

- Insert the lines as docket entries. Rejected: alerts key off `docket_entry.created_at`.
- Treat the order-list date as proof every case on it is already in Jurvio. Rejected:
  matching is exact docket number, one SCOTUS row, or no link.

## Benefits

Cert denials and merits orders can be stored from the Court's list without a
subscriber alert, and an amended list does not replace the earlier PDF.

## Costs and risks

PDF text needs `pdftotext` at apply time. The index report does not require it.
A sealed line that also states a disposition is dropped entirely.

## Reconsideration trigger

Revisit if the orders-index HTML changes, or if a tested alert path for new
(not historical) order-list rows is approved.

## Rollout

1. Deploy migration 0201. Do not enable alerts.
2. Dispatch `diagnose-scotus-coverage-once.yml` with `confirm=DIAGNOSE_SCOTUS_COVERAGE`.
3. Dispatch `ingest-official-scotus-orders-once.yml` with `confirm=DIAGNOSE_SCOTUS_ORDERS`.
   That run only prints the public index.
4. After deploy, a later apply can store one term's lists. Rollback is
   `DELETE FROM scotus_order_list WHERE term_year = '26'`, which cascades items.
   Published cases are unchanged.
