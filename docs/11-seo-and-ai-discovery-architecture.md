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

## 9. Vendor-neutral AI discovery layer

Each public entity exposes:

1. server-rendered semantic HTML;
2. concise answer-first sections;
3. stable headings and source-passage anchors;
4. matching JSON-LD;
5. a versioned JSON endpoint at `/api/v1/{entity_type}/{id}`;
6. source/update dates and evidence classifications;
7. canonical internal graph links.

Do not create a separate free-form “AI file” for every entity. That would duplicate content and risk drift. An optional site-level `llms.txt` may document Jurvio's entity/API conventions, but it is supplementary and not treated as an indexing or ranking guarantee.

This layer is intentionally vendor-neutral. Jurvio will not tailor canonical facts or create duplicate pages for individual AI vendors. All legitimate retrieval systems receive the same public, evidence-aware representation.

### AI answer-readiness requirements

- Put direct, neutral answers in clearly labeled sections such as “What happened,” “What the court decided,” and “Current status.”
- Attach stable source anchors to each material statement.
- Expose dates, jurisdiction, evidence class, document status and canonical entity IDs explicitly.
- Use semantic HTML, accessible headings, crawlable links and descriptive labels.
- Keep facts consistent across HTML, JSON-LD, API responses and snippets.
- Provide correction, supersession and freshness signals.
- Avoid vendor-specific hidden text, keyword stuffing or AI-only claims.
- Measure citations/referrals by platform where identifiers are available.

## 10. Multi-platform crawler policy

- Permit legitimate search and answer-engine crawlers on indexable public HTML.
- Maintain a versioned crawler registry with operator, verified user agent/IP method, purpose, allowed routes, rate policy, documentation URL and last review date.
- Separate search/indexing, user-triggered retrieval and model-training permissions wherever the operator provides distinct controls.
- Never treat a self-declared user-agent string alone as verified when the operator publishes IP or reverse-DNS verification.
- Do not allow crawlers to bypass holds, authentication, rate limits or rights restrictions.
- Ensure Cloudflare/WAF rules do not accidentally challenge approved crawlers.
- Keep a versioned public crawler policy and monitor status codes by verified crawler.

### Initial registry policy

| Platform | Search/retrieval access | Training/downstream-use control | Initial Jurvio recommendation |
|---|---|---|---|
| Google/Gemini | `Googlebot` for Search features | `Google-Extended` separately controls specified Gemini training and grounding uses | Allow search; decide Google-Extended at the companywide training-policy gate |
| Microsoft/Bing/Copilot | `Bingbot`; use Bing Webmaster Tools, sitemaps and IndexNow | Track any separately documented Microsoft AI controls | Allow verified Bingbot and send meaningful updates through IndexNow |
| OpenAI/ChatGPT | `OAI-SearchBot` for search discovery | `GPTBot` separately addresses potential training | Allow OAI-SearchBot; decide GPTBot at the training-policy gate |
| Anthropic/Claude | `Claude-SearchBot` and user-directed `Claude-User` | `ClaudeBot` addresses potential training | Allow search/user retrieval; decide ClaudeBot at the training-policy gate |
| Perplexity | `PerplexityBot` for search and `Perplexity-User` for user requests | Perplexity states these named agents are not for foundation-model training | Allow verified search/user agents subject to security and rate policy |
| Future systems | Evaluate documented purpose and verification | Keep training decisions separate when possible | Default to review, not blanket allow or block |

Google states that `Google-Extended` is a standalone control for specified Gemini training and grounding uses and does not affect Google Search inclusion or ranking ([Google crawler documentation](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers)). OpenAI distinguishes `OAI-SearchBot` from `GPTBot` ([OpenAI Publishers and Developers FAQ](https://help.openai.com/en/articles/12627856-publishers-and-developers-faq)). Anthropic documents separate training, search and user-request agents ([Anthropic crawler policy](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler)). Perplexity similarly documents separate search and user-request agents and publishes IP lists for verification ([Perplexity crawler documentation](https://docs.perplexity.ai/docs/resources/perplexity-crawlers)). Bing recommends sitemaps and IndexNow so Bing and Copilot can detect meaningful URL changes quickly ([Bing Webmaster Guidelines](https://www.bing.com/webmasters/help/webmaster-guidelines-30fba23a)).

The registry must be reviewed at least quarterly and whenever a provider announces a material crawler-policy change. Provider behavior changes do not require changing Jurvio's canonical content architecture.

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
- citations/referrals segmented across Google/Gemini, Bing/Copilot, ChatGPT, Claude, Perplexity and newly detected platforms;
- source-link engagement and correction rate;
- thin-page, duplicate and identity-dispute rates;
- conversion after substantive value is delivered.

SEO success is not raw indexed-page count. It is qualified discovery, trusted engagement and durable index coverage.

## 14. Gate 5B decisions requested

1. Approve a registered-template and deterministic page-quality gate for indexation.
2. Approve nationwide attorney ingestion but threshold-based public/indexed profiles.
3. Approve case-scoped party SEO with explicit identity and allegation safeguards.
4. Approve sitemap partitioning by entity, quality and update cadence.
5. Approve canonical HTML + synchronized JSON-LD + versioned JSON API as a vendor-neutral AI discovery layer.
6. Approve a maintained multi-platform crawler registry that allows legitimate search/retrieval agents and separates all available training controls into a later companywide policy decision.
7. Approve attributed outbound commentary instead of unlicensed republication.
