# Dispatch-only production workflows and a budgeted active-case lane

Status: Accepted with the safety/workflow-triggers change.

## Context

Merging #543 started about ten push-triggered workflows on `main`. Each one listed its own file, or a `.trigger` file, under `on.push.paths`, so editing every workflow at once started all of them. Two were destructive: "Reboot Jurvio ingestion server once" power-cycled the database droplet `jurvio-web-01`, and "Emergency production recovery" restarted Postgres. Production recovered, but any later edit that touched those files would have done the same thing.

Separately, the scheduler job `federal-active-cases` kept being SIGTERM'd at its 20-minute budget (#541). The job only stopped *taking* work at the budget. Dockets already in flight could still page through docket entries, and a 429 from CourtListener slept Retry-After (up to 60 s per attempt, four attempts) inside the budget. `case-citation-graph` failed with postgres.js `MAX_PARAMETERS_EXCEEDED` when a queue batch produced more than 65,534 bind parameters in one `INSERT ... VALUES` list.

## Decision

1. Every workflow in `.github/workflows` is `workflow_dispatch`-only, except this allowlist:
   - `ci.yml` (push and pull_request: tests, lint, typecheck, build);
   - `deploy-public-web-hosted.yml` (`workflow_run` after CI on `main`: builds the image and replaces the public web container on `jurvio-public-01`, running migrations first; nothing else);
   - schedules on `disk-alarm.yml`, `lane-watchdog.yml`, `nightly-db-backup.yml` and `google-search-console-sync.yml`.
2. Every workflow that is not on the explicit read-only list has a required `confirm` input. The first step of every job compares it with the workflow's keyword (the file name in capitals, without `-once`, for example `REBOOT_INGESTION` or `DEPLOY_PRODUCTION`) and exits 1 on a mismatch. A run without the keyword fails closed. Older gates (`RESTRICT`, `INSTALL`, `MEASURE`, `DEPLOY`) are unchanged.
3. `tests/workflow-triggers.test.ts` runs in CI. It parses every workflow and fails on an automatic trigger outside the allowlist, a missing or unchecked confirm gate, or a GitHub-hosted runner outside the three builder-recovery workflows.
4. `lane-watchdog.yml` keeps its 30-minute schedule. A scheduled run only recreates worker containers Docker already reports unhealthy, now with `--no-deps` so Postgres and app are never recreated with them. A manual run needs `confirm=WATCHDOG`.
5. `federal-active-cases` stops taking dockets 4 minutes before its budget. Every CourtListener request is cut off 45 seconds before the budget. The first 429 stops the run, and Retry-After is reported rather than slept. After each docket the job writes `ingestion_checkpoint` stream `federal-active-case-updates`. A docket that fails for its own reasons gets `last_fetched_at` stamped so it moves to the back of the queue. A rate-limit or deadline stop leaves it at the front. The selection query has a statement timeout inside the budget.
6. `syncCitationGraph` inserts through `unnest()` with one array per column (3 or 9 parameters per statement), in chunks of 5,000 rows, and filters by `= ANY(uuid[])`.

## Alternatives

- **Keep push triggers but narrow the paths.** That fails the same way the next time someone edits the workflows in bulk. Removing the trigger cannot.
- **Delete the one-shot workflows.** Some are still the documented recovery path (for example `recover-builder.yml` when builder-01 is down). A confirm gate keeps them available and stops accidental runs.
- **Drop all schedules.** The nightly backup and the disk alarm protect production. The backup only reads the database.
- **Raise the active-case budget.** That only moves the SIGTERM later. The job has to stop on its own.

## Costs and risks

- `outbox-maintenance.yml` (daily outbox drain and retention) and `verify-backup-restore.yml` (weekly restore rehearsal) lost their schedules because they write to the database or run on the production box. Someone now has to dispatch them by hand, or they need a reviewed exception.
- `.trigger` files under `.github/workflows/` and `ops/` no longer start anything.
- A docket whose fetch fails with a transient error is stamped and waits a full rotation.
- Reconsider if an allowlisted schedule needs to change production, or if the confirm keyword turns out too easy to paste by reflex.
