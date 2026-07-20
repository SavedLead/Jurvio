# Jurvio Gate 8E: Document Pages, Entity Pages and Privacy Operations

**Status:** Decision draft  
**Date:** 2026-07-19  
**Launch requirement:** U.S. media/privacy counsel approval

## 1. Research conclusion

Jurvio must model cases, docket entries, documents, opinions, orders and judgments as connected but distinct objects.

CourtListener separates dockets, entries, parties, attorneys and opinion clusters. Justia exposes case metadata, nature of suit, entries and linked opinions. FindLaw combines opinions with reviewed summaries. CaseMine emphasizes judgment summaries, important paragraphs and citation context. Jurvio should combine these strengths while adding plain-language procedure and deterministic status.

Sources:

- https://wiki.free.law/c/courtlistener/help/api/rest/v4/case-law
- https://www.courtlistener.com/help/
- https://dockets.justia.com/
- https://caselaw.findlaw.com/
- https://www.casemine.com/home/guide

## 2. Document-level publishing

Stable URL: `/document/jvdoc-{id}/{descriptive-slug}`. The stable ID—not caption suffixes such as -1/-2/-3—is the identity.

Indexable document pages may include complaints, material motions/responses, opinions, substantive orders, judgments, verdicts, significant briefs and agency complaints/orders. Routine notices, service certificates, duplicates, unavailable records and thin entries remain docket-only or noindex.

Each qualified page includes:

- document type, case, court, entry and filing date;
- filer/parties and judge;
- source and verification state;
- plain-language summary;
- what it requests, argues, decides or orders;
- allegation/argument/finding/order labels;
- impact on deterministic case status;
- important passage anchors;
- readable HTML and permitted PDF;
- cited authorities and context;
- related response/reply chain;
- version/correction history;
- AI/review disclosure.

A party’s argument is never described as a court finding.

## 3. Judgments and opinions

Judgments and opinions are first-class free landing pages.

Judgment pages show exact date/status, claim-by-claim disposition, relief, unresolved claims, relationship to verdict/opinion/appeal, “What it does,” “What it does not decide,” deadlines, source passages, deterministic status impact and subsequent history. Mixed judgments are not reduced to one winner/loser label.

Opinion/order pages show the question presented, holding, reasoning, governing test, important paragraphs, authorities, later treatment, procedural effect, separate opinions and appellate history. Summary statements link to supporting passages wherever possible.

## 4. Entity and taxonomy pages

- Attorney: identity, affiliations, appearances, clients, courts, categories and attributed analysis.
- Judge: court/tenure, appointment facts, opinions, cases and sourced analytics; no personal partisan label.
- Law firm: canonical identity, offices, attorneys, appearances, analysis and aliases.
- Court: jurisdiction, geography, courthouse information, rules, judges, appeal path, cases, opinions and procedure.
- District/jurisdiction: courts, geography, appeals path and jurisdiction explanation.
- Nature of suit: official code/source, fifth-grade explanation, typical claims/parties, what the label does not mean, statutes, procedure, related categories and qualified case listings.
- Cause of action/statute/topic/doctrine: pages only when explanation, provenance and linked records meet quality thresholds.

Listings alone do not justify indexing.

## 5. Privacy request taxonomy

A “removal request” can lead to correction, identity unlinking, redaction, document replacement/removal, name suppression, noindex, URL removal, name-search deindexing, added disposition context or rejection with an appeal path.

Grounds include court sealing/restriction, protected identifiers, minors/victims/safety, mistaken identity, factual error, corrected sources, discretionary discoverability relief and applicable legal rights.

## 6. Identity and abuse controls

Baseline:

- verified account and email;
- exact URLs/fields and declared relationship;
- authority/accuracy attestation;
- evidence appropriate to the ground;
- limited audit retention.

Use a specialist verification vendor for higher-risk ID/selfie checks. Store a verification token/reference, not raw identity images unless counsel requires exceptional retention. Representatives are permitted with proof of authority.

Controls include a case-bound expiring session, verified email before upload, signed uploads, malware scanning, velocity signals, duplicate/coordinated-request detection, step-up verification, manual review and an immutable audit trail.

IP/email counts are risk signals, not automatic rejection: households, firms and shared networks may be legitimate.

## 7. Privacy directives

Do not destructively overwrite the sourced record. Create a versioned directive containing scope, basis, remedy, dates, reviewer, evidence references and appeal history.

An approved directive propagates through:

- case/entity/document pages;
- PDFs, OCR and thumbnails;
- search/autocomplete;
- metadata and JSON-LD;
- APIs, feeds and exports;
- caches/CDN and sitemaps;
- embeddings/RAG and summaries;
- alerts, reports and sensitive analytics dimensions.

Original access is role-limited and audited. Use consistent neutral pseudonyms such as “Individual Party A.”

## 8. Document redaction

For exposed protected data: quarantine all public derivatives; preserve restricted audit evidence only if permitted; create/obtain a valid redacted derivative; verify pixels, OCR, text layers and metadata; publish at a new URL; invalidate search/cache/AI representations; request expedited removal of the old URL; monitor re-ingestion.

Google guidance supports removing the original and publishing a corrected document at a different URL:

- https://developers.google.com/search/docs/crawling-indexing/keep-redacted-information-out
- https://developers.google.com/search/docs/crawling-indexing/remove-information

## 9. Privacy-safe URLs

Launch with identity-independent IDs:

- `/case/jvcase-{id}/{caption-slug}`
- `/document/jvdoc-{id}/{document-slug}`
- `/party/jvparty-{id}/{name-slug}`

Ordinary correction: corrected slug plus permanent redirect.

Privacy-sensitive suppression: neutral slug, purge old named URL from links/sitemaps, normally 410/noindex plus Search Console removal, and no automatic redirect when it would preserve the sensitive name-to-case association. Purge the name from metadata, schema, snippets, autocomplete and machine endpoints.

This may sacrifice link equity; privacy takes priority. Redirect only when policy/counsel permits preserving the association.

## 10. Decisions requested

1. Approve stable-ID pages for qualified substantive filings.
2. Approve judgments/opinions as separate high-value pages.
3. Approve the entity and nature-of-suit portfolio.
4. Approve quality-gated indexing.
5. Approve proportional identity/authority verification.
6. Approve specialist verification without routine raw-ID retention.
7. Approve versioned directives and cross-surface propagation.
8. Approve neutral pseudonyms and non-destructive public projections.
9. Approve removal—not automatic redirect—of privacy-sensitive named URLs.
10. Approve mandatory counsel review before launch.
