# Federal court verification registry, docket-less identity, and opinion-document publication

Status: Prepared for David Rosenberg's approval (code + tests ready; production backfill and
expanded publication not yet authorized).

## Context

Bulk-imported federal opinions could not publish for two structural reasons, not missing
evidence. First, the CourtListener bulk court loader recorded every court as `not_verified`
and never promoted it, so authentic federal courts (district courts, historical circuit
courts, the Tax Court and its predecessors, etc.) failed the publication gate's
`unverified_court_record` check permanently — 48,449 federal draft opinions blocked on this
alone. Second, the gate required a non-empty docket number for a stable identity, but ~6,000
legitimate, mostly historical opinions carry no docket string even though they are stably
identifiable by other means — blocked as `missing_stable_identity`. Separately, the
deterministic federal path published the `legal_case` but never the opinion `document`, so
even an unblocked case exposed no opinion text.

## Decision

1. **Authoritative court registry, not provider trust.** An explicit registry
   (`federal-court-registry.ts`), keyed by CourtListener court id, enumerates the federal
   courts in scope — current (Article III courts of appeals and district courts, Article IV
   territorial district courts, bankruptcy courts and panels, and specialized courts such as
   the Tax Court, Court of Federal Claims, Court of International Trade and Veterans Claims),
   and historical/predecessor courts (U.S. Circuit Courts abolished in 1911, original
   consolidated district courts, and predecessors such as the Board of Tax Appeals, Customs
   Court, Court of Customs and Patent Appeals and Court of Claims, each labeled with its
   successor). The id groups were derived from a read-only dump of the CourtListener court
   universe and cross-classified against authoritative federal court records. Only ids on the
   registry are `verified`; everything else — unknown ids, executive-branch administrative
   tribunals (MSPB, BIA, PTAB/TTAB, boards of contract appeals, …), state/mislabeled entries,
   and two genuinely ambiguous ids held for review — stays `not_verified`. The loader
   promotes registered courts to verified on insert and conflict; it never downgrades a court
   another authoritative pipeline verified and never blanket-verifies on the provider label.
   Migration 0120 applies the same allowlist once to courts already loaded.

2. **Validated alternative identity for docket-less records.** The gate now accepts, in place
   of a docket number, a caption **plus** a provider-scoped opinion/cluster id that resolves
   to the retrieved source record **and** a verified court/case linkage. A caption alone is
   never sufficient, no docket number is ever invented, and the ambiguity/collision,
   sealed/restricted and sensitive-data checks are unchanged.

3. **Reuse the deterministic path for opinion documents.** Rather than a new publisher, the
   deterministic federal path is extended to also publish the opinion `document`, applying the
   same shared opinion-document checks the cited publisher uses (thin text, document
   provenance, verified opinion source, existing publication/review restriction, sensitive
   text). Only draft documents are considered and decision inserts are guarded, so there is no
   double publication; failing documents are held in the shared `citation_publication_hold`
   table and the case still publishes, preserving prior behavior.

## Alternatives considered

- *Blanket-verify all CourtListener federal-code courts.* Rejected: it would verify
  executive-branch tribunals and mislabeled state entries, trusting the provider label.
- *Infer verification from the jurisdiction code at publish time.* Rejected: same blanket
  problem, and it buries the authoritative decision in gate logic instead of an explicit,
  reviewable allowlist.
- *Treat every blank docket as historical / synthesize a docket.* Rejected: David's
  constraint — do not invent dockets or assume blank means historical; require a validated
  alternative identifier.
- *Build a second publisher for bulk opinion documents.* Rejected: duplicates the gate and
  risks divergent rules; extending the deterministic path reuses one bar.

## Benefits

- Authentic federal courts verify through an explicit, auditable source of truth.
- Legitimate docket-less opinions become publishable without weakening identity.
- One set of court, identity and document checks across both publishers.

## Costs and risks

- The registry is a point-in-time allowlist; new or reclassified courts need a registry edit
  (loader) and, for already-loaded rows, a follow-up migration.
- Promoting ~367 courts widens what can publish; mitigated because every other gate check
  (source provenance, thin, sensitive, restricted, collision, review holds) still applies and
  rollout stays gated behind the capped pilot and bounded stages.
- Two ids (`ctappindterr`, `superctsdfla`) are deliberately unresolved and remain unverified.

## Reconsideration trigger

Revisit if authoritative court records reclassify a listed court, if docket-less publication
surfaces mis-identified records in review, or if the shared opinion-document checks need to
diverge between the cited and deterministic paths.
