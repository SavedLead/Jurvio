# ADR 0090: Citation web pipeline (Phase A–D foundations)

Status: accepted (David Rosenberg approved Phase A speed fixes, the CourtListener
bulk citation-map import and live-feed opinion text extraction, 2026-11-01).

## Context

On 2026-11-01 the citations lane parsed one 200-row FIFO batch every 15 minutes
(689,146 documents and 1,008,226 case identities queued, about 36 days of work),
case pages ran a live `DISTINCT ON` join for the Cites / Cited-by lists, the
count snapshot recomputed every published case every 2 hours, and only 7% of
distinct cited reporter keys resolved to a Jurvio case.

## Decisions

1. **Priority queues (A1).** `document_citation_work` and `case_citation_work`
   carry `priority` (10 = live content from the triggers, 0 = backfill). The
   resident lane loops 500-row committed batches for up to 6 minutes, live work
   first, then at most 4 backfill batches, stopping well inside its 12-minute
   kill budget. Bulk backfill is parsed on builder-01
   (`citation-backfill-builder.yml`): the worker image runs on the builder with
   a CPU/memory cap and reaches Postgres over the private VPC (or an SSH tunnel
   through web-01). Heavy parsing never runs on the database server.
2. Later PRs in this series add precomputed edge lists, dirty-set counts, the
   CourtListener citation-map import, stub cited cases and live-feed text
   extraction; each records its decision below.

## Alternatives considered

- Bigger resident batches only: keeps parsing CPU on web-01, which also serves
  Postgres; rejected for the backfill, kept (bounded) for live work.
- Exact `count(*)` backlog stats every run: replaced with planner estimates for
  the totals and exact counts of the small live set.

## Risks and reconsideration triggers

- Builder CPU is shared with CI (one CI test run at a time); the backfill job
  uses `--cpu-shares 256` and a 1.25-CPU cap. Revisit if CI times out.
- If the live queue (priority 10) grows faster than the resident lane drains it,
  raise the resident budget or add a second live pass per interval.

## C8: CourtListener bulk citation map (migration 0173)

`citation-map-import-builder.yml` (confirm=CITATION_MAP_IMPORT, `dry_run=true` by
default) streams `citation-map-<snapshot>.csv.bz2`, `parentheticals-<snapshot>.csv.bz2`
and, for cluster mapping only, `opinions-<snapshot>.csv.bz2` from the free bulk-data
bucket on a builder runner. Nothing touches the CourtListener REST API or either disk.

* `edges`: rows whose citing opinion is a Jurvio CL document. Both ends held ->
  `courtlistener_citation_edge` (depth = max over the cited case's opinions); cited
  end not held -> `courtlistener_citation_unresolved` (uuid + int + smallint).
  Opinions of the same case citing each other are skipped.
* `parentheticals`: kept when written by a Jurvio document (text capped at 2,000 chars).
* `clusters`: a byte-level scan of the opinions export keeps only `id` and
  `cluster_id`, for just the still-unmapped cited opinion ids (`courtlistener_opinion_cluster_map`).
* `finalize`: unresolved rows whose cluster Jurvio holds become edges; parentheticals
  get their cited case; older snapshots are deleted; `citation_edge_build.sweep_requested_at`
  asks the edge builder for an immediate full sweep (it re-applies visibility, so
  hidden, restricted and sealed-caption cases never appear).

Every phase checkpoints `rows_read` in `courtlistener_citation_import` and resumes.

## D11/D13: live-feed opinion text and nightly catch-up (migration 0174)

`live_opinion_text` queues opinions the live feeds recorded without text: district
court-site PDFs (`free_source_item.item_key`), circuit site feeds (the URL at the end
of `coa-feed:*` docket entries) and GovInfo district packages (granule PDF via the
GovInfo API, key sent as `X-Api-Key`, never in URLs). Circuit GovInfo packages stay
with the official appellate pipeline. The resident `live-opinion-text` lane (coa,
every 20 min, 60 docs, native `pdftotext` only) fetches one request per host every
4 s, stores the PDF in the artifact store and the text as a DRAFT `judicial_opinion`
document + `document_content`, which fires the citation triggers. Scanned PDFs are
parked as `ocr_required` for `live-opinion-text-builder.yml` (OCR with tesseract on
the builder, also the N-day backfill). Sealed/restricted captions are never queued;
a case that already has opinion text within a day is marked `duplicate`.
Publication of these drafts is a separate decision (not automated here).

`citation-nightly` (citations lane, hourly tick, once per ET day 01:00-05:00)
re-scans 7 days of live feeds, retries transient live-text failures, re-queues
unparsed live-text documents, and logs queue sizes.

## C9: cited-case stubs (migration 0175)

`citation_stub_case` holds the name, date and citation labels for CourtListener
clusters that a Jurvio citation resolved to (`missing_case_citation.state='resolved'`)
but Jurvio does not hold, copied from `courtlistener_pending_cluster` (unlogged, may
be pruned). Restricted clusters and sealed-looking names are never stubbed; a
stub is removed when its cluster becomes restricted or Jurvio imports the case
(the stub URL then 308s to the case). `/cited/cl-<cluster>` pages are always
noindex/nofollow (meta + X-Robots-Tag), linked with rel=nofollow, and never in a
sitemap (sitemaps list legal_case only). Case pages show "Cited cases not yet on
Jurvio"; stub pages list the published, displayable, non-sealed Jurvio cases that
cite them. `citation-nightly` refreshes stubs (resumable keyset pass).
