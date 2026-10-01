# Source-backed case citations and backlink discovery

Status: Implemented for David Rosenberg's September 30 request.

Published opinions and case narratives link full reporter citations to one
canonical, publication-approved Jurvio case. Existing CourtListener opinion
anchors are resolved by their exact cluster identity and rendered as internal
links. The server emits the anchors; the browser's term annotator preserves them.
Case pages list both cases cited and cases citing this case. These are literal
source relationships; they do not assert positive treatment or legal validity.

PostgreSQL holds citation identities, source-versioned occurrences, durable work
queues, missing-case discovery and publication holds. Migration 0114 initializes
existing opinion work; triggers queue future source revisions. Public queries
use indexed identity/occurrence lookups and reject any key with a second identity,
including a nonpublic second match. Changed source hashes hide stale edges
immediately, and both ends respect publication decisions. Machine metadata
includes only machine-accessible targets.

The core scheduler runs bounded batches every two minutes. A session advisory
lock prevents overlapping workers. Missing cases use exact CourtListener
citation lookup or an existing opinion link's cluster ID; responses and retrieved
opinions retain immutable artifacts. Ambiguous and missing results remain
explicitly unresolved. API errors receive durable retry/backoff. Supreme Court
U.S. Reports gaps use the existing official volume discovery/publisher; recycled
SCOTUS docket numbers never become a citation identity. Verified, meaningful
federal CourtListener opinions can publish using the existing federal source
validation plus document provenance, full-text restriction checks, identity
collision checks and preserved rejection/privacy decisions. Other courts and
records failing validation remain in the existing review path. Source acquisition
uses the existing free source adapters, not paid PACER.

The parser currently supports full U.S., Supreme Court, federal and major regional
reporter citations and exact CourtListener opinion links. Short forms (Id., supra,
pin-only), uncommon/state-specific reporters, slip citations without pages and
citations split across HTML elements are not guessed. The reader's Cases cited
list still provides confirmed destinations when inline typography spans tags.
Extending fixtures/reporters or adopting a separately versioned Eyecite parser
is the next coverage step; it must preserve source spans and ambiguity.

Alternatives: resolving on every visitor request would spend source API budget
and slow pages; linking all citations to search leaves destinations uncertain;
caption-only matching can merge unrelated cases. Durable ingestion plus exact
identities is chosen for maintainability and evidence. Reconsider parser coverage
when unresolved counts show material gaps. Reconsider graph storage/indexes if
indexed case relationship queries no longer meet the site's latency budget.

Validation: domain and publication tests; isolated database integration covering
backfill, revisions, source links, restricted cases/documents, hidden competing
identities, idempotence, publication and preserved privacy denial; repository
lint/typechecks/tests and production job/web builds. Production completeness is
measured by queue counts and sampled real HTML/backlinks, not by deployment alone.

Reference: https://wiki.free.law/c/courtlistener/help/api/rest/v4/citation-lookup
