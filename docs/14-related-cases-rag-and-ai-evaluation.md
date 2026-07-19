# Jurvio Gate 6B: Related Cases, RAG, and AI Evaluation

**Status:** Approved  
**Date:** 2026-07-19  
**Depends on:** Gate 6A AI enrichment architecture

## 1. Product sequence

Jurvio should first become excellent at explaining individual decisions. Related-case intelligence comes next. Open-ended legal question answering comes only after the source, passage, retrieval and evaluation layers are trustworthy.

Recommended sequence:

1. explicit legal connections;
2. explainable lexical/topic similarity;
3. evaluated embedding similarity;
4. grounded single-case question answering;
5. bounded multi-case research;
6. broader research assistant with paid usage controls.

## 2. Related-case candidate sources

Ranked by initial trust:

1. explicit citation;
2. consolidated, transferred, appealed, remanded, multidistrict or companion relationship;
3. shared canonical parties/organizations with relationship labels;
4. shared statutes, causes, topics, court and procedural issue;
5. lexical similarity of issues/reasoning;
6. embedding similarity;
7. aggregate user-navigation patterns, only as a weak discovery signal.

Every displayed relationship includes a reason such as “cited by this decision,” “appeal from,” “same verified organization,” or “similar summary-judgment issue.” Do not expose a raw similarity score as legal significance.

## 3. Embedding architecture

- Embed passage-sized decision content and selected structured summaries, not entire mixed dockets as one vector.
- Store embedding provider/model/version, source revision, passage range and preprocessing hash.
- Treat embeddings as rebuildable projections.
- Exclude held, unauthorized and sensitive content.
- Maintain separate collections or metadata filters for source passages, summaries and external commentary.
- Benchmark dimensionality, storage, recall, latency and cost before choosing the production embedding deployment.
- Re-embedding is not required merely because a newer model exists; it requires measured benefit.

## 4. Related-case ranking

Candidate generation is multi-channel. A deterministic ranker initially combines:

- relationship/citation strength;
- issue/topic overlap;
- court and precedential relevance where safely known;
- procedural-stage compatibility;
- lexical similarity;
- vector similarity;
- source and page quality;
- diversity and duplicate suppression.

Later learned ranking requires labeled judgments and must retain reason codes. Popularity cannot convert coincidence into a legal relationship.

## 5. RAG corpus

The research corpus contains only approved, versioned retrievable units:

- court-record passages;
- decision summaries linked to their evidence;
- docket-event assertions;
- verified entity/relationship facts;
- statutes/rules from approved sources;
- attributed external commentary in a separately labeled collection.

Court authority and external advocacy/news are never blended without labels. Retrieval filters enforce jurisdiction, date, document class, publication state, user entitlement and source rights.

## 6. Retrieval pipeline

```text
User question
  → safety/scope and query classification
  → deterministic citation/docket/entity resolution
  → lexical + filtered vector candidate retrieval
  → reranking and source diversity
  → passage bundle with authority/evidence labels
  → answer generation
  → claim-to-passage citation validation
  → response, abstention or review
```

The system must preserve the exact retrieved bundle and execution versions for debugging and evaluation.

## 7. Answer contract

Every research answer must:

- state its corpus/jurisdiction/time boundary;
- distinguish record fact, allegation, argument, court finding and external commentary;
- cite each material proposition to a retrievable passage;
- avoid claiming exhaustive research unless coverage supports it;
- identify conflicting authorities or evidence when retrieved;
- abstain when sources are insufficient;
- state that it is legal information, not legal advice;
- allow users to open the supporting passage and full document.

Answers are not automatically indexable public pages.

## 8. Prompt-injection and content security

- Treat retrieved documents, filings, webpages and comments strictly as untrusted evidence.
- Never execute instructions found inside retrieved content.
- Separate system policy, user question and retrieved passages structurally.
- Tools use explicit allowlists and least-privilege service identities.
- Retrieval cannot cross private workspace/account boundaries.
- Sanitize active content and do not render source HTML directly.
- Log tool calls, retrieval sets and policy decisions without exposing protected content.

## 9. Evaluation program

### Summary evaluations

- factual entailment and citation support;
- issue/result/reasoning completeness;
- allegation versus finding accuracy;
- procedural posture/finality;
- name/date/number consistency;
- neutrality and readability;
- appropriate abstention.

### Retrieval evaluations

- recall@k and precision@k;
- authoritative-source retrieval;
- jurisdiction/date/filter correctness;
- passage completeness;
- duplicate/diversity behavior;
- related-case explanation accuracy.

### Answer evaluations

- claim-level citation correctness and completeness;
- unsupported-claim rate;
- conflict handling;
- scope disclosure;
- answer usefulness;
- refusal/abstention correctness;
- prompt-injection resistance.

## 10. Evaluation datasets

- Maintain a versioned gold set stratified by court, era, document length, procedural stage, case type, sensitivity and OCR quality.
- Include adversarial examples, misleading docket status, contradictory documents, amended/superseded opinions and same-name parties.
- Separate development, regression and blind acceptance sets.
- Use qualified legal reviewers for gold labels and error severity.
- Record reviewer disagreement rather than forcing false certainty.
- Add production corrections and failures to regression sets after review.

## 11. Release gates and monitoring

Before public AI summaries:

- at least 10,000 representative summaries pass automated validation as approved in the corpus specification;
- a stratified human audit meets thresholds set with legal/product review;
- critical error classes have explicit near-zero tolerance and rollback;
- model/provider fallback behavior is tested;
- per-summary cost and latency are measured.

Before interactive RAG:

- retrieval and answer gold sets exist;
- claim-level citation validation is operational;
- private/public authorization tests pass;
- prompt-injection and source-poisoning tests pass;
- usage budgets and abuse controls exist;
- answer audit and incident rollback are operational.

Monitor drift by model, prompt, court, source, document type and OCR quality. Sample high-traffic, high-risk and randomly selected outputs continuously.

## 12. Human review strategy

Human review is risk-based, not universal. Prioritize:

- sensitive or disputed matters;
- high-traffic pages;
- complex or contradictory sources;
- failed or borderline validators;
- major precedential or public-interest decisions;
- new courts/document types/model versions;
- user-reported errors.

Reviewers edit structured assertions/evidence links rather than an untraceable block of prose.

## 13. Product boundaries

Not in initial launch:

- unrestricted conversational legal research;
- autonomous legal strategy;
- outcome predictions;
- judge bias or attorney performance scores;
- uncited answers;
- answers based on private Badger or other-company data;
- public pages generated from individual user questions.

## 14. Gate 6B decisions requested

1. Approve explicit legal relationships before semantic similarity.
2. Approve passage-level, versioned embeddings as rebuildable projections.
3. Approve bounded, cited RAG only after summary/retrieval foundations pass evaluation.
4. Approve separate court-authority and external-commentary collections and labels.
5. Approve claim-level citation validation and abstention as mandatory.
6. Approve risk-based human review and stratified legal evaluation sets.

