# Explainers and legal glossary strategy

## Decision

Jurvio should treat **legal terms** and **court procedure** as connected but distinct products:

1. The glossary answers “What does this word mean?” quickly.
2. Procedure roadmaps answer “Where am I in the case, and what usually comes next?”
3. Deep explainers answer “Why does this matter?” with context, examples, misconceptions, and official sources.

The public interface should not display editorial review dates. Source links and internal content governance remain important, but a date card adds clutter and can imply that a stable definition is stale.

## Information architecture

- `/explainers`: popular-term cloud, multi-forum roadmaps, subject-area navigation, deep explainers, and searchable glossary.
- `/explainers/[slug]`: durable long-form explanation for important or confusing concepts.
- Future `/legal-dictionary/[term]`, `/legal-topics/[area]`, and `/court-process/[forum]` pages: crawlable landing pages for high-value definitions, subject clusters, and procedural paths. Generate these only when each page offers distinct explanatory value; do not mass-produce thin pages.
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

## Coverage model

Federal, state, and Supreme Court are examples, not the boundary. Coverage has two independent dimensions:

1. **Jurisdiction or forum:** cross-jurisdiction, federal, state, U.S. Supreme Court, administrative, tribal, and international.
2. **Area of law:** civil, criminal, appellate, constitutional, administrative, bankruptcy, business, employment, family, immigration, intellectual property, international, probate, real estate, tax, and arbitration.

This model can add municipal courts, specialized state courts, territorial courts, military justice, the U.S. Tax Court, the Court of Federal Claims, international tribunals, or a new subject area without redesigning the glossary.

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

The expanded seed now also covers criminal procedure, bankruptcy, administrative adjudication, immigration, intellectual property, probate, family, real estate, employment, business disputes, arbitration, tribal courts, and international concepts. Future waves should follow verified corpus demand rather than a fixed list supplied in advance.

Deep explainers should be promoted in waves based on confusion risk, usage, and product relevance. Each should include a neutral hypothetical example. Real-case examples should be added only when the cited case is ingested, publication-approved, accurately linked, and clearly labeled as an illustration rather than a prediction.

## Center coordination

- Homepage/navigation work may add an Explainers entry, but should not duplicate the glossary UI.
- The existing `reviewedOn` field remains internal for now; the public review card and visible date are removed.
- A future data migration can separate glossary records, procedural stages, and case-example links from source code once editorial workflows exist.

## SEO, AEO, GEO, and AI-discovery requirements

- Render useful definitions and category text in server HTML; client-side filtering is enhancement, not the only discovery path.
- Publish stable canonical URLs, descriptive titles, meta descriptions, Open Graph data, breadcrumbs, and internal links.
- Use `DefinedTermSet` and `DefinedTerm` JSON-LD for the dictionary; use `Article` or `FAQPage` only where the visible page content actually qualifies.
- Put the direct plain-English answer first, then jurisdiction caveats, process, examples, related terms, primary sources, and linked Jurvio cases.
- Keep definitions neutral, self-contained, quotable, and explicit about where terminology varies.
- Provide XML sitemap coverage and clean crawl paths for durable term, topic, and process pages.
- Make entities and relationships machine-readable: term, alias, jurisdiction, forum, area of law, procedural stage, governing authority, related terms, and cited cases.
- Avoid keyword stuffing, doorway pages, fabricated frequency claims, invented case examples, and schema that is not supported by visible content.
- Treat “GEO” as optimization for generative answer systems: concise answer passages, entity clarity, primary-source citations, consistent identifiers, and factual update governance.
