# Filing backfill stays within memory and resumes after a kill

Status: Accepted. David asked for this on Nov 18, 2026, after run 44245032121.

## Context

The appeals backfill on sha 0ac16389 resumed from row 5,580,000, logged through row 21,480,000, and was then SIGKILL'd (exit 137). Exit 137 is the kernel out-of-memory killer, not a finished scan. The process was `docker exec` inside the production app container, sharing the host with Postgres and the web server, while `bzip2` decompressed the snapshot. A resume re-parsed every earlier row into a full object before reading anything new, so a rerun could be killed at the same place.

## Decision

Rows already recorded in the checkpoint are counted and discarded without retaining their text. Cells kept for the scan are capped at 8,000 characters and copied off the decompressed chunk. The checkpoint is written every 500,000 rows, and the log line includes `checkpointRows` only after that write returns. If the process RSS reaches 768 MB, the job saves and exits 75 so the workflow starts again from that row. The Node heap for this process is capped at 512 MB. A kill does not write `stopped: complete`. Exit 75 still means resume. The CourtListener list stays at 40 requests a day.

## Alternatives considered

- Leave the 20,000-row checkpoint and the full re-parse. Rejected: the re-parse is what the killer hits, and a SIGKILL cannot flush a last-second save.
- Raise the host memory limit. Rejected: the scan does not need more memory once skipped rows are not retained.

## Benefits

A rerun from row 21,480,000 does not rebuild those rows. The next kill, if the host is still short of memory, continues from the last 500,000-row checkpoint instead of from 5,580,000.

## Costs and risks

Skipping still decompresses the prefix, so the file is read from the start. A checkpoint interval of 500,000 rows can repeat that many rows after a kill.

## Reconsideration trigger

Revisit if a run with this cap is still SIGKILL'd before it logs a new `checkpointRows`, or when the snapshot can be read from a saved byte offset.
