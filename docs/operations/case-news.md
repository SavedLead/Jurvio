# Case news ("In the news")

Requested by David Rosenberg on 2026-10-31: a section on each case page that links
to news coverage of that case, like the news feed on a stock page.

## What is shown

Headline (linked to the publisher, `rel="nofollow ugc noopener"`), outlet, date and
at most a short snippet the source itself provides (an RSS description, cut to 200
characters). Article text is never fetched, stored or shown. The section is hidden
when a case has no visible links.

## Sources and terms (checked 2026-10-31)

| Source | Used | Terms |
| --- | --- | --- |
| GDELT DOC 2.0 API | yes | Free for unlimited commercial use with a citation and link to gdeltproject.org (credited under the section). One request per 5 s; we use 6 s. Headline, URL, domain, date only. |
| Courthouse News Service RSS | yes | CNS invites sites to link to it and use its RSS feeds on their website if no sponsorship is implied; revocable. |
| Agency press releases (DOJ/SEC/FTC) | via the agency-sources job | Public-domain U.S. government works. |
| Google News RSS | no | Feeds are licensed only for personal, non-commercial feed readers. |
| ABA Journal RSS | no (linked via GDELT) | ABA content is for noncommercial personal use; linking is free. |
| JD Supra RSS | no | Republishing needs JD Supra's written consent (syndication partner program). |
| Reuters, AP, Bloomberg Law, Law360, Law.com | no feed (linked via GDELT) | No public RSS licensed for third-party sites; paid syndication only. |

`src/modules/case-news/domain/sources.ts` holds the same registry in code.

## Matching

`src/modules/case-news/domain/match.ts`, rule `case-news-match-v1`. Only the headline
and the source's own snippet are read, plus what the source guarantees (a GDELT
full-text query includes the court name, so every result names the court).

- `docket_number`: the docket appears in the headline/snippet (district style
  `24-cv-01234`, or `No. 25-228` for appellate/SCOTUS), or a GDELT docket query hit.
- `case_name_court`: "X v. Y" in the headline plus court evidence.
- `parties_court_timeframe`: both named sides in the headline, court evidence, and a
  date inside the case's window (from 14 days before filing to a year after decision).

Score >= 0.85 is shown (`auto_published`); 0.60-0.85 goes to the internal review queue
(`pending_review`); lower is dropped. Caps: another published case with the same party
pair (0.80 unless the headline names this court; always for same-court duplicates), a
domain outside the established-outlet allowlist (0.80), only one side named (dropped).
Reviewer decisions (`approved`/`rejected`) are never overwritten by later runs.

Never matched, and never shown even if a link exists: unpublished, suppressed,
restricted or non-displayable cases; captions with sealed / under seal / redacted /
grand jury / juvenile / minor / search warrant / Doe / Roe / anonymous; `-mj-`, `-gj-`,
`-sw-` dockets; any case with a restricted court event (`caseNewsEligibleSql`).

## Job and health

Scheduler job `case-news` (core lane, every 30 min, 14 min budget):
`node jobs/run-case-news.mjs --gdelt-max-requests=90 --gdelt-max-ms=540000 --candidates=300`.
Candidates in priority order: SCOTUS, courts of appeals, cited cases, agency
(SEC/FTC/CFPB/CFTC/DOJ v. company) cases, big-company cases, each with recent activity.
Rechecks: SCOTUS daily, appeals every 2 days, others every 4-5 days
(`case_news_query_state`). One `case_news_run` row per source per run is the health log
(requests, items, links, throttling, errors). GDELT's plain-text throttle notice pauses
30 s, 60 s, ... up to four times per run.

Read-only report: `Diagnose case news (once, read-only)` with confirm=DIAGNOSE.
