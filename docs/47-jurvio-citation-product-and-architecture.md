# Jurvio Citation: product and architecture

Status: foundation implementation started.

## Product promise

Jurvio Citation must answer with inspectable evidence: Does the authority exist? What is its direct history? How have later courts treated the particular proposition? Does the cited page or quotation support the citing sentence?

A status color is navigation, never the conclusion. Every material warning must link to the later authority and exact passage that caused it.

## Must-have layers

1. Universal lookup and citation creation for cases, statutes, regulations, rules, dockets, administrative materials, constitutions, and secondary sources. Resolve parallel, neutral, slip, electronic, unpublished, and docket citations. Support Bluebook-style, ALWD-style, and court-specific output without reproducing proprietary manual text.
2. A citation graph storing document offsets, page and pinpoint, surrounding passage, opinion segment, extraction version, resolved authority, ambiguity, quotations, parallel identity, and direct-history edges separately from treatment.
3. A citator covering direct history and treatment, scoped to the whole authority or a specific issue/passage, with court hierarchy, jurisdiction, en banc status, precedential status, date, depth, quotation, splits, indirect risk, and alerts.
4. Private DOCX/PDF checking for existence, metadata, format, short forms, pincites, quotations, proposition support, treatment, table of authorities, linked exports, isolation, audit, retention, and deletion.
5. Research views for cited/citing authorities, filters, evidence panels, procedural timelines, comparisons, splits, monitoring, and eventually APIs.

## Evidence policy

Every edge stores its source artifact and checksum, exact spans, parser/model version, timestamps, and resolution method. Treatment stores the evidence passage, subject and citing authorities, scope, classifier version, confidence, and review state. AI may propose labels; it may not silently publish an authoritative status.

Jurvio must not display “good law” merely because no negative edge is known. Safe public states disclose verified treatment, potential treatment requiring review, graph coverage date/corpus, and incomplete coverage.

## Delivery order

1. Public exact citation lookup and normalization.
2. Extract citations from published opinions.
3. Resolve authorities and queue ambiguity.
4. Public cited-by/cites views with evidence.
5. Direct-history graph.
6. Conservative treatment classifier and review console.
7. Point-of-law and indirect-risk analysis.
8. Private brief checker, table of authorities, and linked export.
9. Word integration, teams, monitoring, API, and webhooks.

Report coverage by court and date: opinions processed, citations extracted/resolved/ambiguous/unresolved, freshness, direct histories, treatment candidates and reviews, public coverage, accuracy samples, throughput, backlog, and cost. The corpus is materially incomplete, so product and pricing copy must disclose actual coverage.
