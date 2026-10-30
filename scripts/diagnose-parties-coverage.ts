// Read-only diagnostic for the public parties surfaces (/parties, /parties/[id],
// and the per-case Parties tab). It answers one question: when those pages render
// empty, is the cause missing party DATA, or a publication GATE that filters the
// data out?
//
// It runs the exact predicates the public queries use, one clause at a time, so a
// zero can be attributed to a specific clause instead of guessed at:
//   - listPublicEntities  (src/modules/directory/application/public-directory.ts)
//   - listPublicParties   (src/modules/cases/application/list-public-case-sections.ts)
//
// Both surfaces treat a missing entity-level publication_decision as
// displayable; only an explicit decision suppresses a party. Nothing writes an
// entity decision outside the manual publication-review workflow, so the count
// of explicit suppressions is reported below to make that visible.
//
// This script only reads. It writes nothing and publishes nothing.
import { closeDb, db } from "@/db/client";

const sql = db();

try {
  const [ingested] = await sql<{
    entities: string; party_entities: string; appearances: string;
    cases_with_appearances: string;
  }[]>`
    SELECT
      (SELECT count(*)::text FROM entity) AS entities,
      (SELECT count(*)::text FROM entity
        WHERE entity_type IN ('unknown', 'person', 'organization', 'agency')) AS party_entities,
      (SELECT count(*)::text FROM party_appearance) AS appearances,
      (SELECT count(DISTINCT case_id)::text FROM party_appearance) AS cases_with_appearances
  `;

  const [cases] = await sql<{
    total: string; published: string; published_displayable: string;
    published_displayable_with_parties: string;
  }[]>`
    SELECT
      (SELECT count(*)::text FROM legal_case) AS total,
      (SELECT count(*)::text FROM legal_case WHERE publication = 'published') AS published,
      (SELECT count(*)::text FROM legal_case
        WHERE publication = 'published'
          AND COALESCE((
            SELECT decision.displayable FROM publication_decision decision
            WHERE decision.object_type = 'legal_case' AND decision.object_id = legal_case.id
            ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
          ), false)) AS published_displayable,
      (SELECT count(*)::text FROM legal_case
        WHERE publication = 'published'
          AND COALESCE((
            SELECT decision.displayable FROM publication_decision decision
            WHERE decision.object_type = 'legal_case' AND decision.object_id = legal_case.id
            ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
          ), false)
          AND EXISTS (
            SELECT 1 FROM party_appearance WHERE party_appearance.case_id = legal_case.id
          )) AS published_displayable_with_parties
  `;

  // The /parties directory predicate, narrowed one clause at a time.
  const [directory] = await sql<{
    joined_any_case: string; case_published: string; case_displayable: string;
    entity_displayable: string;
  }[]>`
    WITH candidate AS (
      SELECT entity.id,
        legal_case.publication = 'published' AS case_published,
        COALESCE((
          SELECT decision.displayable FROM publication_decision decision
          WHERE decision.object_type = 'legal_case' AND decision.object_id = legal_case.id
          ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
        ), false) AS case_displayable,
        COALESCE((
          SELECT decision.displayable FROM publication_decision decision
          WHERE decision.object_type = 'entity' AND decision.object_id = entity.id
          ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
        ), true) AS entity_displayable
      FROM entity
      JOIN party_appearance appearance ON appearance.entity_id = entity.id
      JOIN legal_case ON legal_case.id = appearance.case_id
      WHERE entity.entity_type IN ('unknown', 'person', 'organization', 'agency')
    )
    SELECT
      count(DISTINCT id)::text AS joined_any_case,
      count(DISTINCT id) FILTER (WHERE case_published)::text AS case_published,
      count(DISTINCT id) FILTER (WHERE case_published AND case_displayable)::text AS case_displayable,
      count(DISTINCT id) FILTER (
        WHERE case_published AND case_displayable AND entity_displayable
      )::text AS entity_displayable
    FROM candidate
  `;

  // The per-case Parties tab, using the shipped predicate from
  // listPublicParties, alongside the explicit suppressions that can remove a
  // party from both surfaces.
  const [caseTab] = await sql<{
    entity_decisions: string; entity_suppressed: string; appearances_visible: string;
  }[]>`
    SELECT
      (SELECT count(*)::text FROM publication_decision WHERE object_type = 'entity') AS entity_decisions,
      (SELECT count(DISTINCT entity.id)::text FROM entity
        WHERE NOT COALESCE((
          SELECT decision.displayable FROM publication_decision decision
          WHERE decision.object_type = 'entity' AND decision.object_id = entity.id
          ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
        ), true)) AS entity_suppressed,
      (SELECT count(*)::text FROM party_appearance appearance
        JOIN legal_case ON legal_case.id = appearance.case_id
        JOIN entity ON entity.id = appearance.entity_id
        WHERE legal_case.publication = 'published'
          AND COALESCE((
            SELECT decision.displayable FROM publication_decision decision
            WHERE decision.object_type = 'legal_case' AND decision.object_id = legal_case.id
            ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
          ), false)
          AND COALESCE((
            SELECT decision.displayable FROM publication_decision decision
            WHERE decision.object_type = 'entity' AND decision.object_id = entity.id
            ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1
          ), true)) AS appearances_visible
  `;

  // Which ingestion path produced the party rows we do have. Only the
  // CourtListener REST docket path writes party_appearance today; bulk CSV,
  // govinfo, and official SCOTUS ingestion write none.
  const bySource = await sql<{ provider_code: string | null; appearances: string }[]>`
    SELECT provider.code AS provider_code, count(*)::text AS appearances
    FROM party_appearance appearance
    LEFT JOIN raw_artifact artifact ON artifact.id = appearance.source_artifact_id
    LEFT JOIN provider ON provider.id = artifact.provider_id
    GROUP BY provider.code
    ORDER BY count(*) DESC
  `;

  const byRole = await sql<{ role: string; appearances: string }[]>`
    SELECT role, count(*)::text AS appearances
    FROM party_appearance GROUP BY role ORDER BY count(*) DESC LIMIT 25
  `;

  process.stdout.write(`${JSON.stringify({
    ingested,
    cases,
    // Each field narrows the previous one. The first field that drops to 0 is
    // the clause responsible for the empty /parties page.
    directoryFunnel: directory,
    caseTab,
    appearancesByProvider: bySource,
    appearancesByRole: byRole,
  }, null, 2)}\n`);
} finally {
  await closeDb();
}
