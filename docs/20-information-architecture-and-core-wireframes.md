# Jurvio Gate 8B: Information Architecture and Core Experience Wireframes

**Status:** Approved  
**Date:** 2026-07-19  
**Depends on:** Approved Gates 1–8A

## 1. Experience hierarchy

Jurvio has three connected surfaces:

1. **Discovery:** search engines, AI systems, news/referrals and Jurvio search land users on entity pages.
2. **Understanding:** readable case records, procedure, evidence labels, context and sources explain what is happening.
3. **Workflow:** follows, alerts, saved searches, reports and collaboration convert repeated need into revenue.

The case is the central narrative object. Parties, professionals, courts, concepts, policies, news and citations are first-class entry and navigation objects.

## 2. Global navigation

Desktop primary navigation:

- Search
- Cases
- People & Companies
- Courts & Judges
- Cases in the News
- Supreme Court
- Legal Guides
- Pricing

Utility:

- Followed
- Saved Research
- Sign in/account

Mobile uses search as the dominant header action and a compact menu. Do not expose every entity type in the top navigation.

## 3. Universal search

One search box accepts:

- person/company;
- case or docket number;
- case caption;
- attorney/law firm/judge;
- court;
- statute/citation;
- legal concept/topic;
- natural-language keywords.

Typeahead groups exact entities before content results. Exact docket/citation matches receive priority. Results state why they matched and support entity-type, jurisdiction, court, date, status, role and source filters.

A first-time user can succeed without learning Boolean syntax. Advanced search remains discoverable for professionals.

## 4. Case page hierarchy

### Above the fold

1. Breadcrumb.
2. Case caption and normalized short name.
3. Court, docket number, judge and status.
4. Plain-language one-sentence answer: “What is this case about?”
5. Evidence-status and freshness strip.
6. Primary actions: Follow, Save, Share.
7. Case Journey with current stage.
8. Latest important development and current practical effect.

### Main content order

1. What this case is about.
2. What is happening now.
3. Parties and what each side wants.
4. Claims and remaining issues.
5. Important decisions.
6. Timeline.
7. Readable docket.
8. Documents and filing reader.
9. Attorneys and firms.
10. Court and judge context.
11. Authorities and Citation Context.
12. Related cases, policies, statutes and coverage.
13. Sources, coverage limits, corrections and update history.

### Desktop layout

- Main reading column: approximately 720–820px.
- Sticky right rail: case status, next event, follow action, key entities and source freshness.
- Long sections use in-page navigation.
- No dense dashboard grid above the narrative.

### Mobile layout

- Single column.
- Sticky compact Follow control.
- Status and next event appear before secondary metadata.
- Hover interactions become tap sheets.
- Tables become labeled cards or horizontal scroll only when necessary.

## 5. Case page modules

### Case Status Card

- active/closed/on appeal/stayed;
- current court;
- latest ruling;
- what is currently in effect;
- next known event;
- last verified.

### Case Journey

Stages are explanatory, not merely decorative. Each completed/current stage opens a plain-language procedural card with source events.

### “What Happened?” update card

- event headline;
- simple explanation;
- why it matters;
- what it does not decide;
- next plausible steps;
- evidence links;
- generated/reviewed status.

### Party Position Card

For each side:

- role;
- factual position attributed to source;
- requested relief;
- surviving/dismissed claims;
- attorneys;
- identity confidence.

Never flatten multiple parties into one position without evidence.

### Claim Map

A row/card per claim:

- claimant and opposing party;
- legal theory;
- plain definition;
- status;
- controlling decision/event;
- relief requested;
- evidence provenance.

### Readable Docket

Default view groups routine entries and elevates material events. Users may switch to the complete chronological docket.

Each item shows:

- source docket number/date;
- plain-language translation;
- filer;
- importance;
- document availability;
- relation to motions/orders;
- source text;
- correction/report control.

### Document Reader

- extracted HTML aligned to page/paragraph provenance;
- original PDF alongside or one click away;
- legal-term, court and citation annotations;
- allegation/argument/finding labels;
- heading outline;
- search within;
- copy citation;
- report extraction problem.

## 6. Understanding interactions

### Legal concept card

- simple meaning;
- meaning here;
- common misunderstanding;
- learn-more concept page;
- source/review status.

### Citation Context card

- cited authority;
- why cited here;
- proposition;
- authority weight;
- treatment;
- relevant passage;
- full case link.

### Court/judge card

- court level and geography;
- why this court matters here;
- appellate path;
- judge role;
- appointing president as factual biography only.

Annotation styling is subtle and consistent. Cards never block selection, scrolling or accessibility.

## 7. Party/person/company page

### Purpose

Capture name-search demand while preventing identity overstatement and guiding users into the litigation graph.

### Above the fold

- canonical/display name;
- person/company/entity-type label;
- identity-confidence notice;
- known location/organization identifiers supported by sources;
- litigation count by role and status;
- Follow action;
- short neutral explanation of why this page exists.

### Content

1. Litigation overview.
2. Cases grouped by plaintiff/defendant/other role.
3. Active matters.
4. Outcomes and dispositions with allegation/finding distinctions.
5. Timeline.
6. Attorneys/firms connected through cases.
7. Related organizations or name variants only when supported.
8. Sources, possible-name-match warnings and correction process.

Never present unverified social profiles, addresses or biographical matches as fact. Similar-name pages remain separate until identity evidence crosses the approved merge threshold.

## 8. Attorney and law-firm pages

Attorney:

- verified identity and jurisdictions;
- firm history with effective dates;
- cases by role, court, matter type and outcome context;
- authored/submitted analysis clearly labeled;
- citations/coverage;
- claim-profile workflow later.

Law firm:

- attorneys;
- represented parties and matters;
- practice/court activity;
- publication feed;
- alerts;
- factual profile versus paid enhancements clearly separated.

No copied ratings or pay-to-change facts.

## 9. Judge and court pages

Judge:

- court/role/status;
- biography and appointment facts;
- case and ruling activity;
- motion/outcome analytics only with methodology and context;
- standing orders and practices;
- cited authorities;
- news/high-interest cases;
- alerts.

Court:

- jurisdiction/geography;
- divisions/courthouses;
- judges, senior judges and vacancies;
- appointing-president composition;
- assignment rules;
- appellate path;
- local rules and procedural guides;
- cases and trends.

## 10. Cases in the News page

### Homepage structure

1. Lead verified development.
2. Trending Now.
3. Fast-Moving Cases.
4. Government & Public Law.
5. Supreme Court.
6. Business/technology/civil-rights topic rows.
7. Upcoming hearings and decisions.
8. Daily/weekly briefing signup.

Every card displays why it is relevant, latest verified event, present effect and updated time. Trending, most-followed, editorial-significance and filing-velocity labels are distinct.

## 11. Government/Public Law case experience

Adds:

- Policy Explainer;
- Policy Status;
- geographic scope;
- government/challenger positions;
- injunction/stay stack;
- conflicting rulings;
- Forum Selection Analysis when warranted;
- available/expected/possible next steps;
- SCOTUS Path Assessment.

The case page remains canonical; the government dashboard is a curated lens, not a duplicate record.

## 12. Supreme Court, Explained

Index views cases by lifecycle stage. Case experience includes:

- question presented in plain language;
- lower-court path;
- why review was sought/granted;
- briefs and argument;
- vote/opinion structure;
- current legal effect;
- remand path;
- related cases and policies.

Emergency matters receive a chronological order/status stack so users can tell what is presently operative.

## 13. Legal guide and concept pages

Canonical pages for terms, motions, burdens, procedures, doctrines, courts and citation concepts.

Template:

1. Simple definition.
2. Why it matters.
3. Common misunderstandings.
4. Where it appears in a case.
5. Examples from cited public decisions.
6. Jurisdictional differences.
7. Related concepts.
8. Sources and review history.

These pages support humans, search engines and AI retrieval without mass-producing thin variants.

## 14. Government Enforcement and Official Sources

Add a Government Enforcement hub and normalized enforcement-matter pages sourced from official agencies. Follow the source registry, lifecycle, evidence-language and neutrality rules in Gate 8C.

The experience connects announcements to filed documents, dockets, companies, public officials, agencies and later outcomes. It distinguishes investigation, allegation, charge, indictment, settlement, finding, conviction, dismissal, acquittal, sentence, appeal and closure.

## 15. Conversion architecture

Contextual calls to action:

- “Follow this case.”
- “Track new lawsuits involving this company.”
- “Alert me when this judge issues a ruling.”
- “Save this search.”
- “Create a cited litigation report.”
- “Monitor this policy.”
- “Get the daily case briefing.”

Do not interrupt first-page comprehension with modal paywalls. Ask for registration at the moment a user creates persistent value. Show paid upgrade only when a free limit or paid-speed/workflow capability is relevant.

## 16. Trust and provenance UI

Every generated explanation exposes:

- source links;
- last verified time;
- explanation type;
- review status where material;
- confidence/coverage warning when needed;
- report/correction route;
- change history for substantive corrections.

A global disclaimer never replaces local evidence labeling.

## 17. Analytics requirements

Capture privacy-safe events for:

- landing entity/type/source;
- section visibility and meaningful reading;
- annotation opens;
- evidence/source clicks;
- follows and saved searches;
- alert creation;
- conversion and upgrade context;
- correction submissions;
- AI/search crawler access;
- zero-result and reformulated searches.

Use these signals to prioritize enrichment and product work, not to change facts or neutrality.

## 18. Initial wireframe acceptance criteria

- A non-lawyer can state what the case is about, its current status and next likely procedural step.
- An attorney can reach the source docket/document without friction.
- Allegations, arguments and findings are visually distinct.
- The primary narrative works without opening tooltips.
- Search landing pages connect naturally to relevant cases and paid monitoring.
- Mobile supports every understanding interaction.
- Page structure remains crawlable without client-side interaction.
- No module requires unsupported AI output to render the canonical facts.

## 19. Decisions requested

1. Approve the global navigation and universal-search hierarchy.
2. Approve the case-page content order and narrative-first layout.
3. Approve party pages as cautious identity-aware SEO entry points.
4. Approve the news, government and Supreme Court page relationships.
5. Approve contextual conversion rather than disruptive paywalls.
6. Approve the Government Enforcement hub and connection to Gate 8C.
7. Approve the trust/provenance UI and wireframe acceptance criteria.
