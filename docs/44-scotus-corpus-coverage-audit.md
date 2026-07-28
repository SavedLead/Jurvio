# Supreme Court corpus coverage audit

Audit date: 2026-07-28  
Baseline: production after merged PRs #64, #70, #72, and #73  
Live sample: `Pitts v. Mississippi`, docket `24-1159`, case `jv-sohiejlw94`

## Verified corpus baseline

- 68 published Supreme Court case records.
- 68 published official Supreme Court PDF documents.
- 68 readable Jurvio-hosted opinion texts.
- Native extraction completed for all 68 documents; 0 OCR holds and 0 extraction failures remained after artifact recovery.
- The sampled live page has 1 document but 0 docket entries, 0 parties, and 0 timeline events.
- The sampled live page incorrectly presents the official slip-opinion release date as the case filing date and therefore overstates a default filing posture. Migration 0016 corrects the data model without inventing a petition date.

## Feature coverage

| ID | Capability | Current verified coverage | Coverage level | Highest-authority next source |
|---|---|---:|---|---|
| B | Question presented | 0/68 structured | Missing | Official docket case page and petition PDF |
| C | Holding, outcome, next step | decision date 68/68 after 0016; holding/disposition not structured | Partial | Official opinion syllabus and judgment text |
| D | Vote, author, justice lineup | official index author code staged; no verified lineup | Missing/held | Opinion headers, separate writings, official Court materials |
| E | Procedural timeline | 0/68 live sample events; corpus count not yet exposed | Missing | Official docket JSON/HTML and orders |
| F | Complete document library | 68 opinion PDFs only | Partial | Official docket document links, briefs, orders, transcripts |
| G | Transcript and audio | 0 structured | Missing | Official oral-argument transcript and MP3 indexes |
| I | Pagination and pinpoints | PDF pages preserved; no structured official page map | Partial | Official slip PDF and U.S. Reports PDF |
| J | Laws and provisions | 0 structured | Missing | Verified citations parsed from official opinion text |
| L | Lower-court history | 0 structured | Missing | Official docket, question presented, opinion syllabus |
| M | Attorneys and advocates | 0 structured | Missing | Official docket, merits briefs, argument transcript header |
| N | Precedents and citing cases | 0 official structured links | Missing | Opinion citations; later Court and CourtListener citations as supplements |
| T | Fact/argument/finding/holding classification | 0 structured | Missing | Deterministic opinion sections first; reviewed enrichment later |
| U | Citation, term, publication metadata | decision date and term 68/68 after 0016; citation when official index supplies it | Partial | Official slip index and U.S. Reports volumes |
| V | Topics/classifications | 0 structured | Missing | Official question presented and opinion text |
| W | Provenance and verification | 68/68 PDFs have official URL, checksum, retrieval record and validated extraction | Strong | Add page count, explicit verification result, and revision relationships |

Counts marked zero are structured-public-data counts supported by repository and live-page evidence, not claims that the underlying opinions lack that information.

## Priority order

1. Correct release-date semantics and add SCOTUS term/citation data (C, U, W). This is the narrow change in this branch.
2. Ingest official docket pages and events (B, E, F, G, L, M, W).
3. Deterministically segment syllabus, judgment, opinion, concurrence, dissent, and Reporter’s Notes (C, D, H, T, W).
4. Preserve official PDF page mapping and citations (I, J, K, N, U).
5. Add reviewed topic and legal-role classification (V, T).

## Data contract added by this branch

`PublicCase` and public case listings now expose:

- `filedOn`: petition/case filing date only; remains null when unavailable.
- `decidedOn`: authoritative Supreme Court decision/release date.
- `supremeCourtTerm`: four-digit October Term year.
- `officialCitation`: official citation exactly as supplied by the Court, or null.

The layout workstream should label `decidedOn` as “Decided,” never “Filed,” and should omit unknown dates instead of substituting the opinion release date.
