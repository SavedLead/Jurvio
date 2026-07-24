# Explainers and legal glossary strategy

## Decision

Jurvio should treat **legal terms** and **court procedure** as connected but distinct products:

1. The glossary answers “What does this word mean?” quickly.
2. Procedure roadmaps answer “Where am I in the case, and what usually comes next?”
3. Deep explainers answer “Why does this matter?” with context, examples, misconceptions, and official sources.

The public interface should not display editorial review dates. Source links and internal content governance remain important, but a date card adds clutter and can imply that a stable definition is stale.

## Information architecture

- `/explainers`: popular-term cloud, federal/state/SCOTUS roadmaps, deep explainers, and searchable glossary.
- `/explainers/[slug]`: durable long-form explanation for important or confusing concepts.
- Future inline definitions: reuse the glossary entry in case pages, opinions, docket entries, and timelines.
- Future case examples: attach verified Jurvio cases to an explainer through structured references. Do not hard-code “recent” examples that become stale or imply a legal conclusion.

## Popularity model

Initial weights are transparent editorial usage tiers, not invented frequency statistics. Once Jurvio has sufficient indexed material, replace or supplement them with reproducible counts from:

- docket-entry text;
- opinions and orders;
- user glossary searches;
- inline-definition opens;
- case-page term encounters.

Counts should be normalized by corpus and jurisdiction so federal ingestion volume does not make state terminology appear unimportant.

## Content expansion

The first broad dictionary covers more than 100 recurring terms across:

- before filing;
- case initiation;
- pleadings and responses;
- discovery;
- motions;
- trial;
- judgment and remedies;
- appeals;
- case status and docket reading.

Deep explainers should be promoted in waves based on confusion risk, usage, and product relevance. Each should include a neutral hypothetical example. Real-case examples should be added only when the cited case is ingested, publication-approved, accurately linked, and clearly labeled as an illustration rather than a prediction.

## Center coordination

- Homepage/navigation work may add an Explainers entry, but should not duplicate the glossary UI.
- The existing `reviewedOn` field remains internal for now; the public review card and visible date are removed.
- A future data migration can separate glossary records, procedural stages, and case-example links from source code once editorial workflows exist.
