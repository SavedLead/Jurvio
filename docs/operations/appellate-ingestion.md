# Federal appellate ingestion operations

This lane exclusively owns official-source acquisition and publication operations for ca1 through ca11, cadc, and cafc. It does not own SCOTUS, district, bankruptcy, or the CourtListener federal bulk lane.

## Operating model

- Current official opinion discovery runs for all 13 courts with fair circuit ordering and bounded concurrency.
- New and updated cases retain reserved capacity while historical work moves newest to oldest.
- The database is the durable queue; every document URL is idempotent per court.
- Native PDF text extraction precedes OCR. OCR is page-scoped and checksum-cached.
- Optional metadata gaps do not block publication. Identity, official provenance, and a usable substantive document do.
- The five-minute watchdog is production-resident. GitHub Actions is manual control and deployment only.

## Initial safe settings

Discovery concurrency: 4 circuits. Download workers: 8. Native extraction workers: 4. OCR workers: 2. Publication batches: 500. Increase only after database latency, source response, memory, and error rates remain healthy.

## Cost policy

Official feeds and pages are free. CourtListener remains the economical historical reconciliation source. PACER is disabled for this lane. Paid OCR and AI enrichment require a hard ceiling and separate approval.

## Recovery

A stale heartbeat is older than 10 minutes. A circuit failure increments its own failure count and receives exponential backoff without stopping the other 12. Persistent malformed records enter `dead_letter`. Never advance a historical checkpoint past an unrecorded failure.
