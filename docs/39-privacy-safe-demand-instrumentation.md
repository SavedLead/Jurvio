# Privacy-safe demand instrumentation

Jurvio records first-party product-demand events to decide which public legal records and explanations deserve investment. The system separates ordinary human use, search crawlers, known AI retrieval crawlers, other automated agents, API clients, internal traffic, and unknown clients. Classification is deterministic and based on the request user-agent plus the requested channel; it does not assert that a client is authentic.

## Collected

- event type and UTC date;
- canonical database relationships to a case, document, entity, or court when available;
- templated route shape, such as `/case/:caseId/documents/:documentId`;
- content kind and delivery channel;
- referrer hostname only;
- known crawler family or a generic client category;
- deterministic legal interest dimensions already present in canonical data, including court, jurisdiction, nature-of-suit code, and procedural phase;
- search result count and coarse query-shape buckets;
- requested explanation kind; and
- separately recorded enrichment cost estimates and actual costs.

## Not collected

- IP addresses;
- raw user-agent strings;
- raw search queries or hashes of those queries;
- entity names or URL slugs in telemetry metadata;
- cookies, stable visitor identifiers, browser fingerprints, or cross-site identity;
- keystrokes, mouse movement, heatmaps, screenshots, or session replay; or
- document text submitted for research.

No analytics failure may block a public request. `recordDemandEvent` is best effort and stores a `privacyVersion` so future policy changes remain auditable.

## Event placement

Server-side capture currently covers published case overviews, party tabs, timelines, dockets, document lists, readable opinions, internal searches, and machine-readable case records. Entity, court, explainer, and user-request actions use the same recorder when their routes or workflows are introduced.

## Interpretation limits

Crawler classification is a useful demand signal, not proof of identity. User-agent strings can be forged. Counts must not be presented as unique people because Jurvio deliberately avoids persistent visitor tracking. Referrer hostname and request volume should guide editorial prioritization, not decisions about an individual.
