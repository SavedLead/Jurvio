# Jurvio Gate 8D: Visual Design System and Detailed Page Specifications

**Status:** Approved  
**Date:** 2026-07-19  
**Depends on:** Approved Gates 1–8C

## 1. Design objective

Jurvio should make complex litigation feel understandable, credible and calm. The visual language combines the clarity of Stripe and Notion, the information discipline of Bloomberg and GitHub, and the restraint expected of a neutral public legal record.

The interface must not resemble a government portal, ad-supported directory, people-search site or document dump.

## 2. Product principles

1. Readability before density.
2. Evidence before interpretation.
3. Simple explanation first; professional depth on demand.
4. Status and legal stage remain visible.
5. Every claim can be traced to a source.
6. Neutrality is communicated through structure and language.
7. Public discovery never feels like a paywall trap.
8. Responsive behavior is specified, not improvised.
9. Accessibility is a launch requirement.
10. Components must support millions of entity pages without bespoke layouts.

## 3. Visual direction

### Color

Use a quiet neutral foundation with one distinctive Jurvio brand color.

- canvas: warm off-white;
- surface: white;
- primary text: near-black navy;
- secondary text: slate;
- borders: cool light gray;
- brand: deep indigo/blue;
- link: accessible blue;
- success/final favorable state: restrained green;
- warning/pending: amber;
- allegation/proposed action: amber or muted orange;
- adverse final result: restrained red;
- informational/procedure: blue;
- unknown/unverified: gray.

Color never communicates legal meaning by itself. Every state also has text and, where useful, an icon.

### Typography

Use a highly legible variable sans-serif for interface and body text. A restrained serif may be tested for judicial-opinion excerpts only; it is not required at launch.

- body reading width: approximately 68–76 characters;
- default body size: 16–18 px depending on context;
- minimum interactive text: 14 px;
- line height: 1.5–1.7 for narrative content;
- tabular numerals for dates, money and docket entries;
- no all-caps paragraphs or decorative legal typography.

### Spacing and shape

Use a 4 px base spacing system, moderate 8–12 px corner radii and subtle borders. Shadows are reserved for overlays, menus and elevated mobile sheets. Information hierarchy should come from spacing and typography rather than nested cards.

## 4. Responsive layout system

- small mobile: 320–479 px;
- large mobile: 480–767 px;
- tablet: 768–1023 px;
- desktop: 1024–1439 px;
- wide: 1440 px and above.

The content canvas caps readable narrative width while tables, timelines and search results can use a wider grid.

Desktop case pages use a main narrative column plus a contextual rail. On mobile, the rail becomes ordered inline sections, and sticky controls are limited to search, follow and section navigation.

## 5. Core component library

### Global components

- brand header and universal search;
- desktop navigation and mobile menu;
- breadcrumbs;
- entity identity header;
- tabs/section navigation;
- filter bar and filter drawer;
- result row and compact entity result;
- pagination or cursor continuation;
- sign-in invitation;
- free-limit explanation;
- pricing/upgrade prompt;
- footer, legal notices and source policy.

### Understanding components

- plain-language summary;
- “What happened / What it means / What happens next” block;
- procedural stage indicator;
- legal-term annotation;
- court/jurisdiction annotation;
- citation-context annotation;
- allegation-versus-finding label;
- confidence/provenance label;
- source citation;
- quoted passage;
- professional-detail disclosure;
- correction/supersession notice;
- “Does not mean” clarification.

### Case and enforcement components

- case status header;
- docket timeline;
- important filing row;
- document viewer/HTML reading mode;
- party/attorney/judge relationship row;
- deadline/event card;
- disposition card;
- enforcement lifecycle;
- monetary relief breakdown;
- agency-versus-reviewing-body path;
- related case/citation card;
- news/analysis source card.

### Engagement components

- follow/watch control;
- alert-frequency selector;
- saved search;
- share/copy citation;
- report/export action;
- feedback/correction control;
- account value prompt.

## 6. Interaction standards

### Legal annotations

A subtle dotted underline signals explainable terms, courts, procedures and citations.

- mouse: hover or focus opens a compact popover;
- keyboard: focus and Enter/Space open it;
- touch: tap opens an accessible bottom sheet;
- second action opens the full glossary, court or cited-case page;
- definitions are versioned, sourced and context-aware;
- the annotation never blocks copying or ordinary reading.

### Disclosures and AI

AI-generated text is labeled when material, but the interface should emphasize source coverage and verification rather than repeatedly displaying model branding. Each generated explanation exposes:

- source documents;
- last generated/verified time;
- material limitations;
- feedback/report option.

### Loading and errors

Use stable skeletons only where layout is known. Do not fabricate incomplete legal states. Partial data must say what is unavailable, what was last verified and whether retrieval will be retried.

## 7. Detailed page specifications

### 7.1 Case page

Above the fold:

1. breadcrumbs;
2. caption, court, docket number and status;
3. compact follow/share actions;
4. plain-language case summary;
5. current procedural posture;
6. last verified timestamp and primary sources.

Body order:

1. what happened;
2. what it means;
3. what happens next;
4. key facts and claims;
5. parties, attorneys and judge;
6. important filings;
7. timeline;
8. docket;
9. cited authorities and citation context;
10. related cases;
11. reporting and attorney analysis;
12. provenance, corrections and notices.

The full docket is not allowed to overwhelm the understanding layer.

### 7.2 Party/person/company page

Above the fold:

- identity name and entity type;
- identity-confidence/disambiguation notice where needed;
- location, role and verified identifiers;
- litigation overview;
- clear explanation of what inclusion on Jurvio does and does not imply.

Body:

- cases grouped by role and current status;
- litigation timeline;
- courts, jurisdictions and case categories;
- attorneys/law firms;
- public-company identifiers and disclosures where applicable;
- related official enforcement matters;
- news and third-party analysis;
- similar-name records kept visibly separate.

No unverified address, social-media or identity match is presented as fact.

### 7.3 Judge page

- official name, court and tenure;
- appointing president and publicly sourced appointment facts;
- current docket/case coverage;
- opinions and major rulings;
- case categories and procedural analytics with methodology;
- citation network;
- related court and district pages;
- no personal partisan label or outcome prediction.

### 7.4 Attorney and law-firm pages

- verified professional identity and affiliations over time;
- jurisdictions/admissions when sourced;
- represented parties and cases;
- case types, courts and outcomes with methodological limits;
- authored case analysis/blog content as attributed external material;
- correction/claim profile workflow;
- no imported third-party rating unless licensed, current and attributable.

### 7.5 Government enforcement matter

- agency/component and legal authority;
- precise stage;
- allegations versus findings;
- subject response when reliably available;
- relief sought versus ordered;
- issuer and reviewing body;
- linked docket/documents;
- lifecycle and later outcome;
- presumption-of-innocence language where applicable.

### 7.6 Search results

One universal search with entity-aware suggestions. Results show why each item matched and separate:

- cases;
- people and companies;
- attorneys and firms;
- judges and courts;
- opinions/documents;
- statutes/topics;
- enforcement matters.

Basic keyword search remains public. Natural-language Ask Jurvio returns one useful anonymous answer before requesting a free account for continued use.

### 7.7 Cases in the News

- objective trend reason;
- current status and last meaningful event;
- neutral plain-language explanation;
- source mix;
- public-interest categories;
- follow control;
- corrections and update history.

Political viewpoint is never a ranking signal.

### 7.8 SCOTUS

- term and calendar;
- cases by stage;
- questions presented in plain language;
- argument and opinion explanations;
- vote and opinion alignment;
- lower-court journey;
- practical effect without advocacy;
- citation and related-case context.

## 8. Accessibility requirements

Target WCAG 2.2 AA.

- complete keyboard operation;
- visible focus;
- semantic headings and landmarks;
- text alternatives;
- sufficient contrast;
- no color-only status;
- reduced-motion support;
- screen-reader announcements for async updates;
- accessible tables with mobile alternatives;
- 44 px touch targets where practical;
- user-controlled text scaling without loss of function.

## 9. SEO and AI-consumer requirements

Every public entity template includes:

- stable canonical URL;
- unique title, description and H1;
- visible factual summary;
- breadcrumbs and internal links;
- structured data appropriate to the entity;
- source and update timestamps;
- crawlable HTML for primary content;
- machine-readable entity identifiers, relationships and provenance;
- bot-specific access governed by one published policy rather than vendor favoritism;
- no separate hidden “AI page” containing facts unavailable to humans.

Machine endpoints may provide JSON/JSON-LD and compact representations, but must remain consistent with the human page.

## 10. Analytics instrumentation

Track privacy-conscious product events:

- landing entity/type/source;
- search query class and successful result engagement;
- annotation opens and full-definition visits;
- summary expansion;
- document/docket engagement;
- follow, signup and paid conversion;
- correction submissions;
- AI-agent and verified crawler access;
- zero-result and abandoned searches;
- topic, court, state, case type and agency demand.

Analytics must distinguish humans, verified crawlers, suspected automation and API clients. The Demand Intelligence Loop can recommend opportunities, but cannot automatically publish pages, change legal explanations or prioritize political viewpoints.

## 11. Design deliverables before implementation

1. brand direction and token sheet;
2. responsive shell;
3. search and results;
4. case page;
5. party/company page;
6. judge page;
7. attorney/law-firm page;
8. enforcement matter page;
9. Cases in the News;
10. SCOTUS hub/case view;
11. document reading mode;
12. annotation popover and mobile sheet;
13. authentication and upgrade states;
14. empty, loading, error, correction and uncertainty states;
15. clickable prototype for the core discovery-to-follow journey.

## 12. Acceptance criteria

- a non-lawyer can identify what happened, what it means and what comes next within one minute;
- a legal professional can reach the source docket/document within one interaction from a key claim;
- allegation, proposed action and final outcome cannot be confused;
- same-name parties remain distinguishable;
- all primary tasks work at 320 px and with keyboard only;
- public narrative content renders in crawlable HTML;
- components support incomplete and conflicting source data;
- upgrade prompts do not interrupt basic public reading;
- templates remain consistent across millions of pages.

## 13. Decisions requested

1. Approve the restrained visual direction and accessibility baseline.
2. Approve the responsive layout and core component families.
3. Approve the detailed page hierarchy for cases and entities.
4. Approve annotation behavior for legal terms, procedures, courts and citations.
5. Approve the SEO/AI principle that machine-readable content must remain consistent with visible human content.
6. Approve privacy-conscious analytics and Demand Intelligence Loop constraints.
7. Approve creation of high-fidelity mockups and a clickable prototype before implementation.
