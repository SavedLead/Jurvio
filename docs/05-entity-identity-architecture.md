# Jurvio Gate 3A: Entity and Identity Architecture

**Status:** Approved  
**Date:** 2026-07-19

## 1. Principle

Jurvio separates a record-supported occurrence from a real-world identity. A name in a court record is evidence that a named party occurred in that case; it is not sufficient evidence that two same-name records represent one person.

## 2. Core entities

| Entity | Meaning | Canonical identity key |
|---|---|---|
| Case | One proceeding in one court | Court + normalized docket number, with source conflict handling |
| Case-party occurrence | One named party and role in one case | Case + source party identifier/ordinal |
| Person | A verified real person connected to occurrences | Jurvio ID after evidence-based resolution |
| Organization | Company, agency, nonprofit, or other body | Jurvio ID plus verified identifiers/aliases |
| Judge | Judicial officer | Jurvio ID plus official/source identifiers |
| Attorney | Legal professional | Jurvio ID plus bar/court identifiers where available |
| Law firm | Legal-services organization | Jurvio ID plus verified names/domains/locations |
| Court | Judicial body | Jurvio ID plus jurisdiction/court code |
| Document | One logical filing, opinion, or attachment | Case + docket position/source identity |
| Document revision | Immutable version of document bytes/text | Document + checksum/revision |
| Docket event | One recorded procedural event | Case + source docket-entry identity |
| Decision | Judicial resolution embodied in a document | Document + decision metadata |
| Authority | Case, statute, regulation, rule, or doctrine cited | Type-specific canonical identifier |
| Topic | Controlled legal subject | Jurvio taxonomy ID |
| Source record | Provider payload and provenance | Provider + provider record ID + revision |

## 3. Relationship model

Relationships are first-class, time-aware, sourced records. Examples include:

- party occurrence `PARTY_TO` case;
- person/organization `RESOLVES_TO` party occurrence;
- attorney `REPRESENTS` party occurrence;
- attorney `AFFILIATED_WITH` firm;
- judge `PRESIDES_OVER` case;
- document `FILED_IN` case;
- document `SUPPORTS` summary statement;
- decision `DECIDES` motion/claim/event;
- decision `CITES` authority;
- case `RELATED_TO` case with a typed basis;
- article `COMMENTS_ON` case;
- entity `HAS_ALIAS` name assertion.

Every relationship stores source, effective dates where known, confidence, resolution method, review state, and supersession history.

## 4. Identity resolution states

| State | Meaning | Public behavior |
|---|---|---|
| Unclassified | Person/organization type unknown | Show occurrence only |
| Candidate | Possible link to a canonical entity | Internal only |
| Probable | Multiple signals support link but not enough for publication | Internal only |
| Verified | Rule or human review meets publication threshold | May appear on canonical profile |
| Disputed | A user or source challenges the link | Remove public merge pending review |
| Rejected | Evidence shows candidate is different | Preserve negative match internally |

AI may propose identity candidates but may not promote them to Verified.

## 5. Person resolution rules

Potential evidence includes:

- unique source identifier;
- bar number or official professional identifier;
- exact uncommon full name plus consistent role and organization;
- explicit document statement connecting aliases;
- counsel-entered or official biographical source;
- consistent location and employment as supporting signals only.

Name similarity, court location, guessed residence, social profile, and employment proximity cannot independently establish identity. Negative evidence and rejected matches are retained so the system does not repeat mistakes.

## 6. Organization resolution rules

Use verified government identifiers, legal names, explicit former names, subsidiaries, domains, addresses, and merger history. Preserve distinctions between:

- legal entity;
- parent;
- subsidiary;
- trade name;
- former name;
- branch/location;
- government agency/unit.

Corporate-family membership does not mean litigation involving a subsidiary belongs to the parent unless the source supports that relationship and the UI labels it.

## 7. Name and alias model

Names are assertions, not overwritten strings. Store:

- exact source-rendered name;
- normalized search form;
- alias type;
- language/script;
- effective dates;
- source;
- confidence;
- display eligibility.

The case caption remains faithful to its source while search supports punctuation, initials, corporate suffixes, former names, and common variants.

## 8. Party-page hierarchy

1. **Occurrence page:** the authoritative initial party landing page, scoped to one case.
2. **Name disambiguation page:** lists distinct occurrences without merging them.
3. **Canonical organization profile:** permitted when organization resolution meets threshold.
4. **Canonical person profile:** deferred by default and published only after separate verification/legal policy approval.

## 9. Evidence and summary assertions

Every generated or editorial statement is stored as an assertion with:

- assertion type;
- subject/predicate/object or text;
- evidence class;
- supporting passages;
- source-set version;
- generator/reviewer;
- confidence and publication state;
- created, verified, superseded timestamps.

This allows the public HTML, JSON-LD, API, snippets, corrections, and future RAG system to use the same evidence-aware record.

## 10. Corrections and disputes

- Corrections never rewrite immutable source records.
- A disputed identity link is removed from public display while reviewed.
- Corrected canonical facts supersede prior assertions with an audit trail.
- Source-level errors are labeled and reported to the provider where appropriate.
- Publication holds operate independently from data retention.

## 11. Gate 3A decisions requested

1. Approve occurrence-first identity architecture.
2. Approve internal candidate matching with no automatic public person merges.
3. Approve verified organization profiles before canonical person profiles.
4. Approve first-class sourced/versioned relationships and assertions.
5. Approve retaining rejected identity candidates as negative evidence.

