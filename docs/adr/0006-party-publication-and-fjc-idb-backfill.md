# ADR 0006: Publishing parties, and back-filling them from the FJC Integrated Database

## Status

Accepted 2026-09-08.

## Context

The public parties surfaces — `/parties`, `/parties/[partyId]`, and the Parties
tab on a case — rendered empty for every visitor. Two independent causes were
found, and they needed different fixes.

**A publication gate that could never open.** `listPublicParties` required an
explicit `publication_decision` row with `object_type = 'entity'` before it would
show a party, defaulting to *not displayable* when none existed. Nothing in the
codebase writes an entity decision outside the manual publication-review
workflow, so that clause hid every party on every case regardless of how much
party data had been ingested. The two directory queries in
`modules/directory/application/public-directory.ts` defaulted the same lookup the
other way, to *displayable*, so the two surfaces disagreed about the same party.

**No party data for the published corpus.** `party_appearance` has exactly one
writer: `ingestCourtListenerParties`, reached only through
`ingestCourtListenerDocket` on the CourtListener REST path. The bulk CSV
importers, the govinfo appellate lane, and the official SCOTUS lanes write no
parties at all. CourtListener's free bulk export contains no party or attorney
table — confirmed against the bucket listing and the published
`load-bulk-data-*.sh` loader — so the REST path cannot be replaced by the bulk
path, and it cannot back-fill a historical corpus at the rate the public v4 API
allows (the appellate lane that depended on it was retired for exactly that
reason).

## Decision

**Parties publish with their case.** A party with no entity-level decision of its
own is displayable, because the gate that matters has already been applied: the
case is published *and* carries a displayable publication decision. An explicit
entity decision still suppresses a party, on both the directory and the case tab.
The two surfaces now share one rule.

**Back-fill parties from the FJC Integrated Database.** The IDB, redistributed by
CourtListener as `fjc-integrated-database-YYYY-MM-DD.csv.bz2`, is the only free
bulk source carrying party names *with roles already assigned by the source*:
every civil row has `plaintiff` and `defendant` columns filled in by the FJC.
Roles are read, never inferred — no caption is split on " v. ", and no appearance
is derived from case style.

An IDB row is matched to a case on district, docket core, office, and filing
year. The core is the FJC's own 7-character `DOCKET` field (2-digit filing year
plus 5-digit sequence); the same value is derived from our full PACER-style
`docket_number` by the new IMMUTABLE `federal_docket_core()` function, which is
indexed so the match is a probe rather than a scan. `federal_docket_office()`
disambiguates two cases sharing a core across offices, and the filing year must
agree on both sides — that guard is what keeps the IDB's century-ambiguous
2-digit year from matching a case from the wrong century.

**Identity is per case: one entity per (IDB row, role).** Names are not merged
across cases. The IDB gives a name string and nothing else — no party
identifier, no address, no counsel — so merging "SMITH" across two districts
would assert a shared identity the source does not support. In a public legal
directory that is the harmful direction to be wrong in.

**The CourtListener REST path stays.** It supplies properly deduplicated
identities, via that provider's own party ids, for the dockets it reaches. The
two sources are complementary: FJC for historical district coverage, REST for
ongoing dockets.

## Alternatives considered

- **Parse parties from case captions.** Rejected. Caption order encodes
  procedural posture, not role — an appellate caption leads with the appellant —
  so a role read off a caption is inference presented as record.
- **Require an entity publication decision, written automatically by the
  publication lanes.** Keeps a per-entity audit row, but adds a second decision
  to every publication path for a gate whose answer is always the same as the
  case's. Rejected as ceremony; the explicit-suppression escape hatch already
  covers the case where the answer differs.
- **Merge parties by normalized name.** Would produce a directory with
  consolidated profiles, and matches how CourtListener models its own party
  table. Rejected: name-only conflation of individuals across unrelated cases is
  precisely the unsupported identity linkage ADR 0005 commits to resisting.
- **Scale up the CourtListener REST party path.** Cannot back-fill history at the
  public API's rate limit; the appellate lane built on that API was already
  retired for perpetual 429s.

## Consequences

Party profiles are thin by construction: most carry a single case, and the IDB
records only the first-listed party on each side, with older names truncated to
the source's field width ("SOUTH TEX SPOR"). Names are stored verbatim, never
expanded or corrected. `getPublicEntity` continues to default `indexable` to
false, so these profiles are displayable without being submitted for indexing —
consistent with not indexing thin or low-confidence pages.

Publishing parties by default widens what is publicly visible about named people
appearing in already-public court records. The suppression path
(`publication_decision` with `object_type = 'entity'`, `displayable = false`)
removes a party from every surface and is the mechanism for any takedown.

## Reconsideration triggers

- Thin single-case profiles measurably harm crawl budget or user trust, making
  consolidated identities worth their conflation risk.
- An evidence-backed identity matcher (shared counsel, address, or provider party
  id) makes cross-case merging defensible.
- A privacy complaint shows that case-level publication is the wrong gate for
  party names, and per-entity review is warranted after all.
- CourtListener adds a party or attorney table to its bulk export, or the REST
  quota rises enough to back-fill history.
