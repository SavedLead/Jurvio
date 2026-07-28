# Official Supreme Court opinion ingestion

## Decision

Jurvio's first Supreme Court connector uses the Supreme Court of the United
States slip-opinion index and its linked PDFs. This is the cheapest reliable
source because it is authoritative, public, requires no API key, and has no
PACER document charge. CourtListener remains a valuable secondary source for
normalization, citations, cross-links, and historical backfill, but it is not
needed to acquire current official slip opinions.

This connector stages source records only. It does not generate summaries,
publish pages, or overwrite the canonical public corpus.

## Safety and cost controls

- Hourly current-term polling plus bounded manual dispatch and a one-time resumable historical slip-opinion backfill.
- One term and a hard limit of 1–100 records per run.
- One index response capped at 2 MiB and PDFs capped at 40 MiB each.
- Official-host allowlisting and PDF signature validation.
- SHA-256 checksums for the index and every PDF.
- Content-addressed raw artifacts preserve the exact retrieved bytes.
- Provider, source URI, source record ID, retrieval time, and artifact links
  preserve provenance.
- Candidate upserts are idempotent on provider and source record ID.
- Every candidate enters `pending_review`; nothing becomes public implicitly.

## Resume and failure behavior

The checkpoint records only the last successfully staged source record.
Resumption finds that exact record in the current official index and continues
from the next position. It does not compare opaque record IDs lexically.

If a record fails:

1. the run item is recorded as failed with a bounded error message;
2. processing stops before later records;
3. the checkpoint remains at the last successful record; and
4. the next resumed run retries the failed record.

This prevents a later success from advancing the cursor past a failure. A
missing checkpoint fails closed for manual investigation instead of guessing.

## First production batch after deployment access is restored

Do not run this batch during the current SSH/deployment freeze. After the
deployment containing this connector is healthy, manually dispatch:

```text
workflow: Ingest official Supreme Court opinions
term: 25
limit: 10
resume: true
```

Expected effect: stage at most ten opinions from the October 2025 Supreme Court
term in deterministic index order, preserve the official HTML and PDFs, and add
all successful candidates to the manual review queue. No AI summaries and no
public pages are created by this run.


## Historical official slip-opinion backfill

The Court keeps term-indexed official slip-opinion pages for October Terms 2018
through 2025. Jurvio reuses the current production connector for these archives.
Each term has an independent durable checkpoint, so retries cannot skip a failed
record or restart completed terms.

A push that changes the production workflow processes terms 2024 through 2018
in descending order with the existing 100-record per-term cap. It then drains
the verified publication queue in bounded batches. The downstream publication
workflow continues native-text extraction until the readable-document backlog
is empty. Hourly scheduled runs remain limited to the current term.

Older cases that are no longer available through the Court's slip-opinion
indexes require the separate official U.S. Reports volume lane. CourtListener
may supplement historical metadata and readable text but is not required for
official-source publication.
