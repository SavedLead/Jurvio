# Jurvio Gate 3C: Initial Wireframes and Page Descriptions

**Status:** Decision draft  
**Date:** 2026-07-19

These are structural wireframes, not visual design. They define hierarchy and behavior before colors, typography, brand, or component implementation.

## 1. Global shell

**Desktop header:** Jurvio logo | prominent universal search | Cases | Courts | Topics | Watchlist | Sign in.

**Mobile header:** logo | search button | menu. Search opens as the primary full-width action.

**Footer:** product explanation, coverage, methodology, corrections, API, legal, crawler policy, and source acknowledgments.

## 2. Case page

```text
[Breadcrumb]
[Case caption]                         [Save / Watch]
[Court · docket · status · dates · last checked]

[Important record-language notice when applicable]

[Case overview with sentence-level source markers]

[What the court decided]
[Outcome] [Reasoning] [What remains]

[Tabs/anchors: Overview | Timeline | Documents | Authorities | Coverage]

[Procedural posture]
[Important timeline]

[Parties]                 [Judge / Attorneys / Firms]

[Key decisions and documents]
[Cited cases and statutes]
[Related cases]
[Related reporting and commentary]

[Sources, coverage limits, corrections, disclaimer]
```

The overview and actual decision remain above the fold on common desktop sizes. Raw docket detail is available but does not dominate.

## 3. Case-party occurrence page

```text
[Breadcrumb]
[Name as shown in record]
[Role in Case X · Court · docket · date]

[Identity notice: this page concerns this name in this specific case]

[What the record says about this party's role]
[Allegations versus decisions]
[Source links]

[Case summary]
[Counsel in this case]
[Relevant timeline events]

[Other records with the same/similar name]
[No assertion that they are the same person]

[Correction / identity issue]
```

No subscription teaser or inferred personal profile appears on this page.

## 4. Name disambiguation page

```text
[Name]
[Explanation: multiple court-record occurrences may involve different people]

[Filter by court, state, year, role]

[Occurrence card]
  Role · case · court · date
  Short neutral context
  Verified source

[Occurrence card ...]

[Identity correction link]
```

Cards are organized by distinct occurrence, not merged into a biography.

## 5. Organization profile

```text
[Verified organization name] [Aliases/former names]
[Entity type · identifiers · verification sources]

[Litigation overview]
[Active / resolved case counts with coverage notice]

[Recent and significant cases]
[Timeline of litigation events]
[Courts, topics, attorneys/firms]
[Related organizations with relationship labels]
[News/commentary]

[Coverage and identity methodology]
```

Counts always state the covered corpus and must not imply complete nationwide history.

## 6. Judge page

```text
[Judge name]
[Court · position · service dates · official source]

[Biography/official context]
[Recent decisions]
[Cases by topic and procedural type]
[Frequently cited authorities]

[Coverage explanation]
```

No win-rate, bias score, or outcome prediction in v1.

## 7. Attorney or law-firm page

```text
[Name] [Attorney/Firm]
[Verified identifiers and affiliations]

[Cases in Jurvio's covered corpus]
[Courts, roles, topics]
[Recent appearances/decisions]

[Coverage and identity notice]
```

No performance ranking or implied complete client list.

## 8. Search page

```text
[Large universal search input]
[Interpreted query: person / company / docket / citation / keyword]

[Type tabs: All | Cases | Parties | Organizations | Judges | Attorneys | Documents]
[Filters]

[Typed result cards with exact-match explanation]
[Coverage notice]
```

Exact docket/citation matches appear first. Same-name ambiguity is visible rather than hidden.

## 9. Court/topic browse page

```text
[Court or topic identity]
[Plain-language description and coverage]

[Recent significant decisions]
[Active/recent cases when available]
[Judges / authorities / subtopics]
[Year and document-type navigation]
```

## 10. Visual design direction

- Professional, restrained, and information-dense without appearing crowded.
- Reading experience closer to a high-quality financial/research product than a court portal.
- Neutral color system; color never independently conveys legal status.
- Strong typography, generous reading width, compact metadata, and progressive disclosure.
- Source markers feel integral rather than footnote clutter.
- No sensational imagery, advertising-heavy sidebars, or fear-based conversion design.

## 11. Gate 3C decisions requested

1. Approve search as the dominant global action.
2. Approve decision/overview content above raw docket detail.
3. Approve dedicated occurrence and disambiguation experiences.
4. Approve restrained professional visual direction.
5. Approve deferring rankings/predictions and aggressive conversion UI.

