# AGENTS.md

## Project mission

Jurvio is a public legal intelligence platform designed to make litigation searchable, understandable, connected, and monitorable.

## Current phase

The repository is in architecture and product-planning mode.

Do not create production application code, install frameworks, provision infrastructure, or add database migrations until the architecture approval gate is explicitly recorded as approved by David Rosenberg.

## Working principles

- Preserve court records as the authoritative source.
- Separate allegations, party arguments, court findings, procedural events, and AI-generated explanations.
- Attach provenance to important normalized data and derived claims.
- Prefer deterministic processing when it is reliable.
- Use AI selectively, with citations, confidence, model/version history, and reproducibility.
- Optimize for a small team's maintainability.
- Prefer a modular monolith over premature microservices.
- Do not introduce specialized infrastructure without a demonstrated workload.
- Treat SEO, accessibility, performance, and AI discoverability as product requirements.
- Do not index thin, duplicate, low-confidence, or low-value pages.
- Preserve raw source records separately from normalized canonical entities.

## Change discipline

- Work on a dedicated branch.
- Keep changes scoped to the active approval gate.
- Preserve unrelated work.
- Never use destructive Git operations.
- Document material technical decisions in an ADR.
- For each recommendation, record alternatives, benefits, costs, risks, and a reconsideration trigger.
- Do not commit credentials, tokens, private keys, personal data exports, or production secrets.

## Verification

Documentation changes must be internally consistent and free of unsupported factual claims. Future code changes must include proportionate tests, linting, type checks, security checks, and documented verification results.

## Approval gates

1. Strategy
2. Product
3. Data
4. Discovery
5. Intelligence
6. Platform
7. Execution

Application implementation begins only after the relevant architecture package is explicitly approved.
