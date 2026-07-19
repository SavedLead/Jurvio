# Jurvio Gate 2B: Case Page v1 Product Requirements

**Status:** Approved  
**Date:** 2026-07-19  
**Depends on:** Approved Gate 1 strategy and Gate 2A corpus specification

## 1. Product objective

The Case Page is Jurvio’s primary product, search landing page, knowledge-graph hub, and trust surface. A first-time visitor must be able to determine within seconds:

1. What is this case?
2. What happened?
3. What did the court actually decide?
4. Is it ongoing or finished?
5. Who is involved?
6. Where can each important statement be verified?

## 2. Primary users

- A member of the public researching a person or company.
- A solo or small-firm lawyer evaluating a case.
- A journalist or investigator following litigation.
- A business professional assessing litigation risk.
- A search engine or AI retrieval system seeking structured, citable facts.

## 3. Page hierarchy

### A. Identity header

- Canonical case caption.
- Court and jurisdiction.
- Docket number.
- Filing and termination dates when known.
- Current status with confidence/source.
- Nature of suit and cause where sourced.
- Jurvio case ID.
- Last checked date.
- Breadcrumbs.

### B. Case overview

- Two-to-four sentence plain-language overview.
- Neutral description of the dispute.
- Clear allegation language for contested claims.
- Linkable supporting source references.
- Visible “AI-assisted, source-linked summary” label where applicable.

### C. What the court decided

Shown only when a court decision exists.

- Decision date.
- Deciding judge/court.
- Motion or issue decided.
- Result.
- Core reasoning.
- Effect on parties/claims.
- Whether further proceedings remained.
- Direct links to supporting passages and full decision.

The section must never infer victory, liability, innocence, guilt, or finality solely from a docket status code.

### D. Procedural posture

- Stage when the decision occurred.
- Claims/motions then before the court.
- What had and had not been adjudicated.
- Appeal/remand context when known.

### E. Timeline

Timeline entries contain:

- date;
- event type;
- plain-language title;
- short explanation;
- source filing/document;
- evidence classification;
- significance level;
- correction/version status.

Default view shows important events. Users may expand to the full docket where available.

### F. Parties

- Party name as shown in the record.
- Role in this case.
- Case-party occurrence link.
- Organization/person/unknown classification.
- Counsel when sourced.
- No implication that same-name occurrences are the same person.

### G. Attorneys, firms, and judge

- Name and role.
- Relationship effective dates when known.
- Source relationship.
- Links to qualifying entity pages.
- No performance score or outcome prediction in v1.

### H. Key documents

- Decisions and substantive orders first.
- Selected pleadings necessary to understand the case.
- Document date, docket number, type, page count, text availability, and source.
- Readable HTML when rights and text quality permit.
- Original/source PDF link.
- Stable page/paragraph anchors.

### I. Authorities and topics

- Cited cases.
- Cited statutes and regulations.
- Legal topics and doctrines.
- Binding/persuasive relationship only when deterministically supportable.
- Related cases based on explicit links first; semantic similarity later.

### J. Related coverage and commentary

- Publisher/firm name.
- Article title, author, and publication date.
- Short original Jurvio description.
- Canonical outbound link.
- Clear distinction between news/commentary and the court record.
- Sponsored material, if ever introduced, cannot influence case facts or ranking and must be separately labeled.

### K. Coverage and provenance

- Sources used.
- First and last retrieval dates.
- Known coverage limitations.
- Missing-document indicators.
- Summary generation/review status.
- Correction and identity-dispute links.
- Public-record and no-legal-advice disclaimer.

## 4. Evidence language model

Every material statement is typed as one of:

- **Allegation:** a claim made by a party and not treated as established.
- **Argument:** a legal or factual position presented by a participant.
- **Undisputed record fact:** supported and not materially contested in the relevant source set.
- **Court finding:** expressly found or determined by the court.
- **Order:** a court directive or ruling.
- **Disposition:** a documented procedural or merits outcome.
- **Administrative event:** docket activity without a merits determination.

The public wording, snippets, structured data, and machine endpoint must preserve these distinctions.

## 5. Source-link behavior

- Material summary sentences display one or more source indicators.
- Selecting a source opens the relevant document passage, not merely the document’s first page.
- The source viewer preserves document page number and extracted-text anchor.
- If passage alignment is unavailable, Jurvio says so and links to the document.
- Source links remain stable across presentation redesigns.
- A later corrected summary preserves the prior audit record internally.

## 6. Free and account actions

### Available without an account

- Read all core case explanations.
- View party and participant relationships.
- Search basic public records.
- Open readable decisions and source links.
- Share canonical URLs.
- Submit a correction or identity issue.

### Free account, when monitoring launches

- Save cases.
- Create a small number of watch items.
- Receive daily/weekly digest.
- Maintain reading and saved-item history.

### Future paid actions, not v1 launch requirements

- Immediate alerts.
- Larger watchlists.
- Saved searches and complex filters.
- Research collections and collaboration.
- Bulk exports.
- Advanced full-text and Boolean search.
- Analytics.
- Cited AI research with usage limits.
- API/webhooks.

No basic case explanation is hidden behind registration or payment.

## 7. Search and conversion behavior

A visitor arriving from a party-name search should see:

1. The case and party role immediately.
2. A same-name/identity warning where appropriate.
3. What is alleged versus decided.
4. The source-supported case explanation.
5. A low-pressure introduction to Jurvio as a litigation-understanding platform.
6. An optional save/watch action after receiving value.

Jurvio must not use fear-oriented language or imply that a subscription reveals hidden damaging information.

## 8. SEO requirements

- Server-rendered crawlable HTML.
- One canonical URL per case.
- Docket-number and caption aliases redirect to the canonical URL.
- Descriptive unique title and meta description.
- Breadcrumbs.
- Indexable text does not depend on client-side interaction.
- Structured data matches visible facts.
- Internal links to court, parties, judge, attorneys, decisions, authorities, and topics.
- XML sitemap partitioned by entity type and update cadence.
- Thin/duplicate pages use `noindex` or are not generated.
- Search snippets use neutral evidence-aware language.
- Pagination/filter URLs do not create unlimited crawl spaces.

## 9. AI-discovery requirements

- Visible concise answer sections.
- Stable entity ID and canonical URL.
- Embedded JSON-LD.
- Versioned JSON entity endpoint.
- Explicit relationship and evidence types.
- Source and update dates.
- Passage-level links.
- Crawler access policy for legitimate search/retrieval bots.
- Analytics attribution for AI referrals where available.
- No material facts exposed only in machine markup.

## 10. Accessibility and performance

- WCAG 2.2 AA target.
- Keyboard-accessible navigation and source viewer.
- Semantic headings and landmarks.
- Readable typography and line lengths.
- Responsive mobile layout.
- No layout shift from summary/document loading.
- Public case pages cached at the edge.
- Performance budget to be finalized during technical architecture.

## 11. Trust and safety requirements

- Prominent record-status and allegation language.
- Same-name warning when identity is not verified.
- Correction and identity-dispute intake.
- Publication hold capability.
- Sensitive-data filtering before indexing and AI processing.
- No inferred addresses or social profiles in v1.
- No judge predictions or attorney rankings.
- No legal advice.
- No summary when evidence is insufficient.
- Visible source limitations and freshness.

## 12. Analytics

Measure:

- organic entry page and query class;
- party-name versus case/citation entry;
- summary/source-link engagement;
- time to first source verification;
- timeline and full-docket expansion;
- save/watch conversion;
- correction and identity-dispute rate;
- AI referral traffic;
- indexation and crawl efficiency;
- enriched versus source-only engagement;
- cost per enriched page and returning professional user.

Do not optimize for pageviews alone. The leading product signal is whether users understand the case and trust the explanation.

## 13. Case Page v1 acceptance criteria

1. A user can identify the court, case, parties, status, and latest meaningful outcome without opening a PDF.
2. Allegations are never presented as findings.
3. Each material summary statement is supported by accessible source evidence or explicitly marked as unsupported/unavailable.
4. The page remains useful without an account or payment.
5. The page renders crawlable text and valid canonical/structured metadata.
6. The HTML, JSON-LD, and JSON endpoint do not materially conflict.
7. Duplicate captions/docket aliases resolve to one case identity.
8. Same-name parties are not automatically merged.
9. A correction or publication hold can be applied without deleting source history.
10. Mobile, accessibility, and performance checks pass.

## 14. Explicit non-goals

- Replacing Westlaw/Lexis citators.
- Predicting judge outcomes.
- Providing legal advice.
- Summarizing every docket entry.
- Publishing a complete background report about each party.
- Selling access to basic public facts.
- Allowing paid commentary to affect the factual record.

## 15. Gate 2 decisions requested

1. Approve the Case Page as Jurvio’s primary launch product.
2. Approve the section hierarchy in this PRD.
3. Approve evidence-typed statements and passage-level sourcing as mandatory.
4. Approve fully free core case explanations without account walls.
5. Approve party-search conversion only after the visitor receives substantive value.
6. Approve deferring open-ended AI research, analytics, and professional citator features.
