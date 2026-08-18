import { closeDb, db } from "../src/db/client";

type Sql = ReturnType<typeof db>;

async function backfillUsaoCaseAttribution(sql: Sql, limit: number) {
  const rows = await sql<{ id: string }[]>`
    WITH candidates AS (
      SELECT DISTINCT
        office.id AS office_id,
        appearance.case_id,
        appearance.source_artifact_id
      FROM party_appearance appearance
      JOIN entity party ON party.id = appearance.entity_id
      JOIN legal_case legal_case ON legal_case.id = appearance.case_id
      JOIN usao_office_court office_court ON office_court.court_id = legal_case.court_id
      JOIN usao_office office ON office.id = office_court.office_id
      WHERE appearance.role IN ('plaintiff', 'petitioner', 'appellant')
        AND lower(regexp_replace(party.display_name, '[^a-z0-9]+', '', 'g'))
          IN ('unitedstates', 'unitedstatesofamerica')
        AND NOT EXISTS (
          SELECT 1 FROM usao_case_assignment assigned
          WHERE assigned.office_id = office.id AND assigned.case_id = appearance.case_id
            AND assigned.relationship = 'filed_or_prosecuted'
        )
      ORDER BY appearance.case_id
      LIMIT ${limit}
    )
    INSERT INTO usao_case_assignment (
      office_id, case_id, relationship, evidence_type, source_artifact_id,
      confidence, matcher_version
    )
    SELECT office_id, case_id, 'filed_or_prosecuted', 'party_role_and_district',
      source_artifact_id, 0.995, 'usao-party-district-v1'
    FROM candidates
    ON CONFLICT (office_id, case_id, relationship) DO NOTHING
    RETURNING id
  `;
  return { assigned: rows.length };
}

const rawLimit = process.argv.find((value) => value.startsWith("--limit="))?.split("=")[1] ?? "10000";
const limit = Number(rawLimit);
if (!Number.isInteger(limit) || limit < 1 || limit > 50000) {
  throw new Error("--limit must be an integer from 1 to 50000");
}

backfillUsaoCaseAttribution(db(), limit)
  .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
  .finally(closeDb);
