# Federal metadata publication, resumable chunk import, and the SCOTUS guard

Status: Implemented. Metadata-only publication stays off until David Rosenberg runs the
enable workflow. The chunk importer starts on the next ingestion-box release.

## Context

By late October 2026 the federal lane was stuck behind one-off diagnostics.

- 86,795 cases sat in `federal_publication_hold` (diagnostic run 40467097721, Oct 27):
  83,033 `missing_readable_content`, 17,564 `unverified_court_record`, 21
  `duplicate_identity_collision`. Reason tags overlap, so the metadata-only set is the
  rows whose reason array is exactly `{missing_readable_content}`.
- CourtListener bulk opinions: 44 of 384 chunks completed (~44k of 383,824 matched
  opinions). On Oct 27 two detached importers were launched (runs 40487336239 and
  40487685592) and the ledger did not advance after that.
- The full-speed publication drain (run 40289848335, Oct 26) failed in 16 seconds with
  `Connection timed out during banner exchange` to `10.116.0.2:22`. A retry 17 minutes
  later was cancelled while still on that SSH step.
- Every SCOTUS freshness-guard run since #527 (which cut the job to 20 minutes) is
  cancelled at 20 minutes. The three successful runs immediately before that cut took
  27, 26, and 29 minutes on the same step.
- Diagnostic run 40467097721 died on its collision query. The SQL reads
  `legal_case.case_name`, and that column does not exist (`caption` does). `bash -se`
  aborted the script and `2>/dev/null` hid the error.

Issue #179 already says to publish verified metadata before opinion text.

## Decision

1. **Metadata-only publication is an explicit switch, default off.**
   `JURVIO_PUBLISH_FEDERAL_METADATA_WITHOUT_OPINION_TEXT=1` (or
   `--publish-metadata-without-text=1`) makes `missing_readable_content` non-blocking
   and re-opens a hold only when that is the sole reason. Court verification, provenance,
   sealed text, and collisions still hold. Published metadata-only cases are displayable
   and not indexable, and the case page says the opinion text is pending. The resident
   `federal-publication` scheduler applies the flag; there is no separate mass-publish
   job in this change. The owner turns it on with
   `.github/workflows/enable-federal-metadata-publication-once.yml`.

2. **SCOTUS leaves this publisher.** The court registry already refuses to verify
   `scotus` because the official pipeline owns it. The deterministic candidate query now
   excludes it, matching the cited publisher. Migration 0125 drops existing SCOTUS holds
   and returns still-draft rows this lane marked `needs_review` to `not_verified`.
   The Oct 12 court-universe run showed 20,118 draft SCOTUS cases on an unverified
   CourtListener court, which lines up with the 17,564 `unverified_court_record` holds.
   Remaining unverified holds are courts the registry deliberately does not verify
   (administrative tribunals, state mismatches, `ctappindterr`, `superctsdfla`). The
   docket importer no longer blanket-verifies every court it touches.

3. **One supervised importer, files on the artifacts volume.** Chunk files were written
   to `/var/lib/jurvio/federal-chunks` inside worker-core. That path is not a volume.
   Run 38251524796 recorded `ENOENT` for
   `.../opinions-2026-09-30-000000.jsonl.gz` after the file disappeared, while other
   chunks in the same container still imported at about 20–25 opinions/second
   (1,000 opinions in ~35–50s). `docker exec -d` into worker-core is not restarted when
   the process exits, and a worker recreate (deploy or the lane watchdog) kills it and
   deletes the files. A `worker-federal-import` service now runs the same idempotent
   ledger loop with a 768MB heap (the old launcher set 8GB inside the scheduler
   container), reclaims abandoned `importing` rows on start, and refuses to claim chunks
   when a sample of files is missing. The release copies the legacy directory onto the
   artifacts volume before recreating workers. New extracts default to that volume.

4. **SSH to the ingestion box retries.** `deploy-production.yml` already documents that
   bursty connections are dropped during banner exchange. The publication drain, the
   chunk importer, the hold diagnostic, and the metadata switch use a five-attempt
   backoff helper instead of one 15-second try.

5. **The scheduled SCOTUS freshness guard is retired.** `worker-core` already runs
   `scotus-enriched` every five minutes and `scotus-publish` every three minutes, the
   same idempotent ingest/publish/extract path. The guard's repair step needs ~30
   minutes and was cancelled at 20, so since #527 it has occupied the only builder and
   finished nothing. `workflow_dispatch` remains, with a 45-minute limit, for a manual
   repair if the scheduler is down.

## Alternatives considered

- *Raise the guard timeout back to 60 minutes.* Rejected: that is the builder-hog #527
  was written to stop, and the on-box scheduler already covers the work.
- *Keep launching the importer with `docker exec -d`.* Rejected: the Oct 27 launches
  returned success at spawn time and nothing resumed them. The files also do not survive
  the container they were spawned in.
- *Bump `FEDERAL_PUBLICATION_RULE_VERSION` so every hold is re-evaluated.* Rejected for
  this release: it would walk all 86k holds on the next scheduler cycle. The metadata
  switch re-opens only sole `missing_readable_content` holds, and migration 0125 drops
  holds that are stale because text arrived or because the case is SCOTUS.
- *Verify every CourtListener federal-code court to clear `unverified_court_record`.*
  Rejected: ADR 0075. The docket importer's blanket `verification = verified` is removed.

## Benefits

- Verified case metadata can publish before opinion text, behind one flag, without
  indexing thin pages.
- The opinion import survives process death, worker recreation, and a second launch.
- The freshness guard stops consuming the builder every four hours.
- The hold diagnostic reports the collision sample and the unverified-court breakdown
  instead of exiting on a missing column.

## Costs and risks

- Metadata-only pages are thin. They stay `indexable = false` and `noindex` until an
  opinion with text is published. Turning the flag on lets the resident publisher
  publish on its existing cadence (up to 25,000 cases per 12-minute cycle).
- Copying chunk files during release needs free disk. The box was at 33% on Oct 29.
  If the legacy directory is already gone, the importer logs `chunk-files-missing` and
  does not mark the ledger failed; the extract workflow has to be run onto the
  artifacts volume.
- At the measured 20–25 opinions/second, the remaining ~340,000 opinions are about
  4–6 hours of importer time once the files are readable. A chunk that is still
  `importing` from the Oct 27 launch is reclaimed when the service starts.

## Reconsideration trigger

Revisit if authoritative records add a court the registry should verify, if
metadata-only pages should become indexable, if opinion import rate stays under ~10/s
after the move to the volume, or if the on-box SCOTUS scheduler misses a release the
manual guard would have caught.
