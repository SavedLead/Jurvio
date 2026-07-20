# Jurvio Gate 8F: Complete Core Page Family

**Status:** Design review draft  
**Date:** 2026-07-19

## Completed concepts

Case overview, final judgment/document, full docket, case parties, attorney, judge, law firm, court, nature of suit and universal search are designed as one visual family. Documents, attorneys, timeline, citations, news and related-case subpages reuse the approved case shell.

## Shared case shell

Every case route shows the opaque case ID in its canonical URL; caption, court and official docket number in visible content; prominent deterministic status; latest status event; source and verification time; real-link subpage navigation; follow/share actions; evidence-language labels; and correction/provenance access.

Status remains visible on Docket, Parties, Documents and every other case route.

## Docket

The complete chronological docket supports search and filters for importance, document availability, court rulings, date and type. Entries show filer, source, type and a short explanation. Important rulings stand out without hiding routine entries. Large dockets use stable pagination/date navigation; arbitrary filter URLs are not indexed. Public reading remains free while export may be paid.

## Parties

Every participant shows exact role, identity confidence, participation period, status, counsel and independent entity link. The page states that inclusion does not imply wrongdoing or liability. Representation is time-aware; same-name entities are not silently merged; people-search presentation is prohibited.

## Attorneys and firms

Profiles separate affiliations, public appearances, represented clients, jurisdictions, category coverage, attributed articles, activity, methodology and correction/claim workflow. Counts say “Based on Jurvio-covered public cases.” Unsupported ratings, win rates, rankings and marketing claims are prohibited.

## Judges

Pages show role/jurisdiction, service/appointment facts, current public cases, opinions, procedural categories, category coverage, citations, appellate path and sources. Appointing president is factual metadata. Jurvio does not assign personal partisan labels, ideology scores, outcome predictions or rankings.

## Courts

Pages explain jurisdiction, geography, appellate path, judges, cases, opinions, filing resources, rules, divisions and news. Aggregated appointing-president facts carry the statement that they are not ideology scores. Official contact/filing details link to authoritative sources and show verification dates.

## Nature of suit

Qualified pages include official label/code/source, fifth-grade explanation, what the category does not mean, typical disputes/parties, causes/statutes, usual procedure, related categories, qualified cases, distributions and methodology. Nature of suit is clearly identified as an administrative classification—not a merits finding. Listings alone do not qualify for indexing.

## Search

Free keyword results combine but distinguish entities, cases, professionals, courts, documents and enforcement. Results explain matches; cases show status; entities show identity confidence; documents show type/summary; enforcement distinguishes allegations from findings.

Ask Jurvio remains a separate natural-language mode with one complete anonymous answer before free-account sign-in for continued use. Saving searches and alerts requires a free account; results remain public.

## Canonical examples

- `/case/jv-7glk9q2m`
- `/case/jv-7glk9q2m/docket`
- `/case/jv-7glk9q2m/parties`
- `/case/jv-7glk9q2m/documents/jd-4km8px7r/final-judgment`
- `/attorney/ja-{opaque-id}`
- `/judge/jj-{opaque-id}`
- `/law-firm/jf-{opaque-id}`
- `/court/jc-{opaque-id}`
- `/nature-of-suit/190-other-contract`

Names remain in titles, headings, breadcrumbs, relationships and descriptive anchors—not opaque canonical identity paths.

## Acceptance criteria

- status appears in the first viewport on every case route;
- source/verification information is visible;
- analytics disclose coverage/methodology;
- entity identity is separate from one case appearance;
- each indexable page has substantial unique value;
- public information is readable without sign-in;
- mobile/keyboard equivalents preserve primary tasks;
- thin pages stay out of sitemaps/indexing;
- privacy directives change public projections without changing IDs.

## Remaining pre-implementation designs

Mobile variants; remaining case states; company/enforcement pages; News and SCOTUS; HTML document reader; annotation popovers/sheets; authentication/alerts/conversion; empty/uncertain/corrected/sealed/privacy states; and a clickable discovery-to-follow prototype.
