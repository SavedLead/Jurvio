# ADR: Closed-loop Judge Autopilot

## Decision

Operate federal-judge ingestion, matching, publication, public-page verification, and reporting as one closed loop inside the existing server-resident ingestion supervisor. Judge Autopilot measures the authoritative FJC roster, service terms, matcher backlog, assignments, publication decisions, and live public routes. It applies bounded idempotent repairs and records every detection and action in the existing append-only repair ledger.

## Alternatives

A dashboard-only monitor was rejected because it detects without restoring service. A separate privileged infrastructure agent was rejected because Docker-socket or host access would expand the blast radius. Manual reruns were rejected because they depend on owner intervention.

## Benefits, costs, and risks

The system repairs incomplete or stale roster data, missing safe publication decisions, and matcher backlog without human prompting. It verifies both the directory and a real profile through HTTP and exposes one row per imported judge. It adds FJC traffic only when stale or incomplete and matcher work only when backlog exists. It cannot safely rewrite application code or restart arbitrary host services; container restart policies and the deployment pipeline retain those responsibilities. All failed repair attempts remain visible instead of being hidden.

## Safety boundary

Only verified FJC identities are automatically published. Ambiguous matches remain review-only. Repairs use advisory locking, idempotent inserts, bounded batches, timeouts, and the existing audit log. The agent does not bypass review states, fabricate identities, spend money, modify credentials, or expose privileged host controls.

## Reconsideration trigger

Reconsider the host-control boundary only if repeated measured incidents prove that container restart policies cannot recover runtime failures and a narrowly scoped, audited orchestrator API is available.
