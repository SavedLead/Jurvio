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
