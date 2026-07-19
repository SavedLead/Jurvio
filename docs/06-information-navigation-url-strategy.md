# Jurvio Gate 3B: Information, Navigation, and URL Strategy

**Status:** Decision draft  
**Date:** 2026-07-19

## 1. Information architecture

### Primary public entities

- Cases
- Decisions/opinions
- Documents
- Party occurrences and name disambiguation
- Organizations
- Judges
- Attorneys
- Law firms
- Courts and jurisdictions
- Statutes, regulations, rules, topics, and doctrines
- Related reporting/commentary

### Primary navigation

The global header remains intentionally small:

- Search
- Cases
- Courts
- Topics
- Watchlist, once accounts launch
- Sign in

Entity directories are primarily reached through search, internal links, breadcrumbs, and browse pages rather than a crowded mega-menu.

## 2. Discovery paths

### Public researcher

Search engine → party occurrence/disambiguation → case explanation → decision/source → related entity → optional watch/save.

### Legal professional

Jurvio search → results/filters → case → key decision and authorities → source passages → save/watch/export later.

### Journalist/business investigator

Company/topic/court page → recent litigation → case timeline → parties/documents → related coverage → watchlist.

## 3. URL principles

- One canonical URL per logical entity.
- Human-readable slug plus opaque stable ID.
- Slugs may change; stable IDs do not.
- Old slugs permanently redirect to the canonical URL.
- Court docket aliases resolve to one case.
- URLs do not expose provider IDs as Jurvio identity.
- Filters use query parameters and are `noindex` unless promoted to an approved landing page.

## 4. Recommended URL patterns

| Entity | Pattern |
|---|---|
| Case | `/cases/{caption-slug}-{case_id}` |
| Decision | `/decisions/{decision-slug}-{decision_id}` |
| Document | `/documents/{document-slug}-{document_id}` |
| Case-party occurrence | `/parties/{name-slug}-{occurrence_id}` |
| Name disambiguation | `/people/{name-slug}-{name_id}` |
| Verified person | `/people/{name-slug}-{person_id}` with explicit profile type internally |
| Organization | `/organizations/{name-slug}-{org_id}` |
| Judge | `/judges/{name-slug}-{judge_id}` |
| Attorney | `/attorneys/{name-slug}-{attorney_id}` |
| Firm | `/law-firms/{name-slug}-{firm_id}` |
| Court | `/courts/{court-slug}-{court_id}` |
| Statute | `/statutes/{jurisdiction}/{code-slug}/{section}` |
| Topic | `/topics/{topic-slug}-{topic_id}` |
| Search | `/search?q=...` (`noindex`) |
| API entity | `/api/v1/{entity_type}/{id}` |

Using an opaque ID prevents caption changes, duplicate names, and docket-format differences from breaking URLs. The slug supplies readability and search context.

## 5. Breadcrumbs

Breadcrumbs reflect user context without creating multiple canonical paths. Examples:

- Home → Federal Courts → Second Circuit → Case
- Home → Parties → John Smith → Case occurrence
- Home → Courts → Southern District of New York → Judge
- Home → Topics → Antitrust → Case

The entity page canonical remains the same regardless of the path used to reach it.

## 6. Browse architecture

Approved, indexable landing pages may include:

- federal court and circuit pages;
- district pages;
- year-by-court pages when substantive;
- nature-of-suit pages;
- carefully curated topic pages;
- judge/attorney/firm/organization pages meeting thresholds;
- recent decisions and significant litigation pages.

Arbitrary combinations such as court × year × judge × topic × sort are not indexable. A landing-page registry explicitly controls what may be indexed.

## 7. Search result architecture

One search box recognizes names, captions, citations, docket numbers, courts, judges, attorneys, firms, statutes, and keywords. Results are grouped or typed, not silently blended. Initial filters:

- entity type;
- court/jurisdiction;
- date;
- case status;
- document type;
- nature of suit/topic;
- party role.

Semantic and Boolean search are deferred, but the result model must support them later.

## 8. SEO and crawl controls

- Entity-type sitemap indexes with size/update partitions.
- Canonical tags and redirect registry.
- `noindex` for internal search, thin pages, unresolved duplicates, and uncontrolled filters.
- Minimum-content and source-quality checks before index eligibility.
- Crawl-priority score based on substance, freshness, links, demand, and risk.
- Internal links use canonical IDs and descriptive anchor text.
- No orphaned indexable entities.
- Structured metadata mirrors visible content.

## 9. AI discovery controls

- Allow legitimate search/retrieval crawlers under a documented policy.
- Publish stable JSON entity endpoints derived from canonical records.
- Use source dates, evidence classes, and passage anchors.
- Maintain site-level documentation of entity and citation semantics.
- Keep machine and human representations synchronized.

## 10. Gate 3B decisions requested

1. Approve the compact primary navigation.
2. Approve readable slugs plus opaque stable IDs.
3. Approve occurrence URLs under `/parties/` and disambiguation/verified profiles under `/people/`.
4. Approve an explicit indexable-landing-page registry instead of unlimited generated filters.
5. Approve grouped/typed universal search.

