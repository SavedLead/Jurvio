# Jurvio Gate 5B: SEO and AI Discovery Architecture

**Status:** Decision draft  
**Date:** 2026-07-19  
**Depends on:** Approved URL/entity architecture and Gate 5A search design

## 1. Principle

Jurvio will earn large-scale organic visibility through useful, source-linked legal explanations, not mass generation for its own sake. The same canonical record powers visible HTML, structured metadata, machine endpoints, sitemaps and internal links.

Google's spam guidance focuses on whether scaled content exists to manipulate rankings, regardless of whether automation or people produced it. Jurvio therefore needs substantive page gates, editorial accountability and evidence—not merely unique wording ([Google guidance on scaled content](https://developers.google.com/search/blog/2024/03/core-update-spam-policies)).

## 2. Indexable page registry

Only registered templates may emit `index,follow`:

- qualifying case pages;
- decisions and readable substantive documents;
- case-party occurrence pages meeting the approved safeguard threshold;
- name disambiguation pages with multiple useful occurrences;
- verified organization profiles;
- qualifying attorney, judge and firm pages;
- courts and approved court/year pages;
- controlled topics and authorities;
- Jurvio-authored editorial pages.

Internal search, arbitrary filters, empty directories, unresolved duplicates, low-confidence profiles, login/workspace pages and thin records remain `noindex` and outside sitemaps.

Google notes that `noindex` must be crawlable to be observed and is not supported as a robots.txt directive ([Google noindex documentation](https://developers.google.com/search/docs/crawling-indexing/block-indexing)).

## 3. Page-quality gate

An indexability decision is deterministic and auditable. Required signals vary by entity, but include:

- stable canonical identity;
- minimum primary-source support;
- enough unique visible information to satisfy the likely query;
- source and last-checked dates;
- no active publication hold;
- acceptable identity confidence;
- non-duplicative title, description and main content;
- meaningful internal links in and out;
- valid canonical and structured data;
- template-specific risk checks.

Traffic potential alone cannot make a thin or risky page indexable.

### Attorney-page threshold

Publish/index when the page has verified professional identity plus at least one of:

- sufficient sourced appearances in Jurvio's covered corpus;
- meaningful official biography/licensing context;
- substantive attributed publications/commentary;
- claimed and verified profile data that passes moderation.

Jurvio may ingest attorneys nationwide while keeping incomplete profiles private or `noindex`. This protects search quality and reputation.

## 4. Party-name SEO

For a case-scoped occurrence page, the title and opening text identify:

- name exactly as it appears in the record;
- party role;
- case caption;
- court and date;
- whether the page is case-scoped rather than a verified biography.

The page must explain allegations versus findings, provide case context and link to evidence. Same-name occurrences are not merged. No fear-based snippet, inferred home address, social-profile guess or subscription teaser is permitted.

Name disambiguation pages organize distinct records by court, role, date and case. They must state that occurrences may involve different people.

## 5. Canonicals and duplicate control

- Self-referential canonical on every canonical HTML page.
- Permanent redirects for old slugs, merged entities and docket/caption aliases.
- Internal links and sitemaps use only canonical URLs.
- Query parameters for sort, filters, tracking and display modes never become canonicals.
- Readable HTML is canonical over duplicate text/PDF presentations where policy permits; use an HTTP canonical header for non-HTML duplicates.
- Conflicting canonical signals fail deployment checks.

Google treats redirects and `rel=canonical` as strong signals and sitemap inclusion as weaker; the signals should agree ([Google canonical guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)).

## 6. Sitemap architecture

Root sitemap index partitions by entity class, quality tier and update cadence:

```text
/sitemaps/index.xml
  /sitemaps/cases/recent-001.xml.gz
  /sitemaps/cases/archive-001.xml.gz
  /sitemaps/decisions/2026-001.xml.gz
  /sitemaps/party-occurrences/quality-a-001.xml.gz
  /sitemaps/organizations/001.xml.gz
  /sitemaps/attorneys/verified-001.xml.gz
  /sitemaps/courts-topics/001.xml.gz
```

- Keep files below the protocol maximum of 50,000 URLs/50 MB; Jurvio should target approximately 40,000–45,000 URLs for operational headroom ([Google sitemap limits](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)).
- `lastmod` changes only for meaningful visible updates.
- Removed/noindexed/redirected URLs leave sitemaps promptly.
- Partitioning enables Search Console measurement by entity and quality tier.
- Sitemaps are generated from the publication registry, not database existence.

## 7. Internal-link graph

Every indexable page must have at least one crawlable inbound path and relevant outbound links. Link priorities:

- case ↔ parties, court, judge, attorneys, firms, decisions and authorities;
- organization ↔ qualifying cases, subsidiaries/parents with labels and commentary;
- attorney/firm ↔ appearances, parties represented and authored analysis;
- decision ↔ cited cases/statutes and source passages;
- court/topic ↔ substantive recent and representative decisions.

Links use descriptive text and canonical IDs. Related-content modules must be relevant, limited and explainable, not link farms.

## 8. Metadata and structured data

Visible content and structured data must agree. Recommended types, subject to validation:

- `WebSite` and Jurvio `Organization` on appropriate site-level pages;
- `BreadcrumbList` on entity pages;
- `WebPage` or a more specific `ProfilePage` for verified profiles;
- `Person` only for verified people/professionals;
- `Organization` for verified organizations and firms;
- `Article`/`NewsArticle` only for Jurvio-authored editorial content where applicable;
- `Dataset` for genuine dataset/coverage landing pages, not each case;
- `CreativeWork`/`DigitalDocument` and citation properties where semantically accurate, without claiming unsupported Google rich-result eligibility.

Google recommends markup that reflects the page and useful real-world identity details; structured data does not guarantee a rich result ([Google Organization structured data](https://developers.google.com/search/docs/appearance/structured-data/organization)).

## 9. AI discovery layer

Each public entity exposes:

1. server-rendered semantic HTML;
2. concise answer-first sections;
3. stable headings and source-passage anchors;
4. matching JSON-LD;
5. a versioned JSON endpoint at `/api/v1/{entity_type}/{id}`;
6. source/update dates and evidence classifications;
7. canonical internal graph links.

Do not create a separate free-form “AI file” for every entity. That would duplicate content and risk drift. An optional site-level `llms.txt` may document Jurvio's entity/API conventions, but it is supplementary and not treated as an indexing guarantee.

## 10. Crawler policy

- Permit legitimate search crawlers on indexable public HTML.
- Permit `OAI-SearchBot` on eligible public pages so Jurvio content may be included in ChatGPT search summaries and citations.
- Decide `GPTBot` training access separately; search inclusion and potential model training are distinct policy choices.
- Do not allow crawlers to bypass holds, authentication, rate limits or rights restrictions.
- Ensure Cloudflare/WAF rules do not accidentally challenge approved crawlers.
- Keep a versioned public crawler policy and monitor status codes by verified crawler.

OpenAI's publisher guidance distinguishes `OAI-SearchBot` for search discovery from `GPTBot` controls for potential training and recommends allowing the former when publishers want summary/snippet inclusion ([OpenAI Publishers and Developers FAQ](https://help.openai.com/en/articles/12627856-publishers-and-developers-faq)).

## 11. Content attribution and law-firm commentary

- Jurvio's case page may show title, author, publisher, date, classification, permitted excerpt and Jurvio-authored synopsis.
- Canonical outbound link goes to the original publisher.
- Counsel/client relationship or firm representation is disclosed when known.
- Publisher-submitted content undergoes moderation and cannot alter court facts or organic ranking through payment.
- Full republication requires permission/license.
- Duplicate or lightly rewritten publisher material does not become a separate Jurvio editorial page.

## 12. Rendering and performance

- Main entity content and metadata are present in the initial server response.
- No indexable fact depends on user interaction or client-only rendering.
- Edge-cache public pages with event-driven invalidation.
- Use accessible semantic landmarks and descriptive link text.
- Establish template performance budgets before implementation and monitor field performance separately by page type.

## 13. Measurement

Track by entity/template/quality tier:

- submitted, discovered, crawled and indexed URLs;
- Google-selected canonical disagreements;
- crawl requests/status codes and render errors;
- impressions, clicks, query classes and party-name entrances;
- sitemap inclusion-to-index lag;
- rich-result and structured-data validity;
- ChatGPT and other AI referrals;
- source-link engagement and correction rate;
- thin-page, duplicate and identity-dispute rates;
- conversion after substantive value is delivered.

SEO success is not raw indexed-page count. It is qualified discovery, trusted engagement and durable index coverage.

## 14. Gate 5B decisions requested

1. Approve a registered-template and deterministic page-quality gate for indexation.
2. Approve nationwide attorney ingestion but threshold-based public/indexed profiles.
3. Approve case-scoped party SEO with explicit identity and allegation safeguards.
4. Approve sitemap partitioning by entity, quality and update cadence.
5. Approve canonical HTML + synchronized JSON-LD + versioned JSON API as the AI discovery layer.
6. Approve `OAI-SearchBot` access and a separate later decision on `GPTBot` training access.
7. Approve attributed outbound commentary instead of unlicensed republication.

