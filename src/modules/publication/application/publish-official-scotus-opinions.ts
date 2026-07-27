import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

export function normalizeScotusIdentity(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/\bversus\b/g, "v")
    .replaceAll(/\bvs\.?\b/g, "v")
    .replaceAll(/[^a-z0-9]+/g, "");
}

export function isSameScotusCase(left: string, right: string): boolean {
  return normalizeScotusIdentity(left) === normalizeScotusIdentity(right);
}

interface Candidate {
  id: string;
  docket_number: string;
  case_name: string;
  filed_on: string;
  source_pdf_uri: string;
  source_content_hash: string;
}

interface Match {
  case_id: string;
  case_public_id: string;
  case_caption: string;
  cluster_id: string;
  cluster_case_name: string;
  document_id: string;
  document_public_id: string;
}

export async function publishVerifiedOfficialScotusOpinions(
  sql: Sql,
  options: { limit: number },
) {
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100) {
    throw new Error("Publication limit must be between 1 and 100");
  }

  const candidates = await sql<Candidate[]>`
    SELECT id, docket_number, case_name, filed_on::text, source_pdf_uri, source_content_hash
    FROM official_opinion_candidate
    WHERE review_status = 'pending_review'
    ORDER BY filed_on, source_record_id
    LIMIT ${options.limit}
  `;

  let published = 0;
  let held = 0;
  const publicRecords: Array<{ caseId: string; documentIds: string[] }> = [];

  for (const candidate of candidates) {
    const matches = await sql<Match[]>`
      SELECT legal_case.id AS case_id, legal_case.public_id AS case_public_id,
        legal_case.caption AS case_caption, cluster.id AS cluster_id,
        cluster.case_name AS cluster_case_name, document.id AS document_id,
        document.public_id AS document_public_id
      FROM legal_case
      JOIN court ON court.id = legal_case.court_id
      JOIN opinion_cluster cluster ON cluster.case_id = legal_case.id
      JOIN judicial_opinion judicial ON judicial.cluster_id = cluster.id
      JOIN document ON document.id = judicial.document_id
      JOIN document_content content ON content.document_id = document.id
      WHERE lower(regexp_replace(legal_case.docket_number, '[^a-zA-Z0-9]', '', 'g'))
        = lower(regexp_replace(${candidate.docket_number}, '[^a-zA-Z0-9]', '', 'g'))
        AND lower(court.provider_court_id) = 'scotus'
        AND cluster.date_filed = ${candidate.filed_on}
        AND content.word_count > 0
      ORDER BY legal_case.id, cluster.id, document.id
    `;

    const compatible = matches.filter((match) =>
      isSameScotusCase(candidate.case_name, match.case_caption) ||
      isSameScotusCase(candidate.case_name, match.cluster_case_name)
    );
    const caseIds = new Set(compatible.map((match) => match.case_id));
    const clusterIds = new Set(compatible.map((match) => match.cluster_id));

    if (compatible.length === 0 || caseIds.size !== 1 || clusterIds.size !== 1) {
      held += 1;
      await sql`
        UPDATE official_opinion_candidate
        SET reviewer_notes = ${compatible.length === 0
          ? "Held: no exact readable CourtListener opinion match"
          : "Held: ambiguous canonical case or opinion-cluster match"},
          last_seen_at = now()
        WHERE id = ${candidate.id}
      `;
      continue;
    }

    const first = compatible[0];
    if (!first) continue;
    const documentIds = [...new Set(compatible.map((match) => match.document_id))];
    const documentPublicIds = [...new Set(compatible.map((match) => match.document_public_id))];

    await sql.begin(async (tx) => {
      await tx`
        UPDATE legal_case
        SET verification = 'verified', publication = 'published', updated_at = now()
        WHERE id = ${first.case_id}
      `;
      await tx`
        INSERT INTO publication_decision (
          object_type, object_id, displayable, indexable, machine_accessible,
          downloadable, summary_eligible, reason_code, rule_version
        )
        SELECT 'legal_case', ${first.case_id}, true, true, true, false, true,
          'owner_authorized_official_scotus', 'official-scotus-publication-v1'
        WHERE NOT COALESCE((
          SELECT displayable FROM publication_decision
          WHERE object_type = 'legal_case' AND object_id = ${first.case_id}
          ORDER BY decided_at DESC, id DESC LIMIT 1
        ), false)
      `;

      for (const documentId of documentIds) {
        await tx`
          UPDATE document SET publication = 'published', updated_at = now()
          WHERE id = ${documentId}
        `;
        await tx`
          UPDATE judicial_opinion
          SET source_download_url = ${candidate.source_pdf_uri}, updated_at = now()
          WHERE document_id = ${documentId}
        `;
        await tx`
          INSERT INTO publication_decision (
            object_type, object_id, displayable, indexable, machine_accessible,
            downloadable, summary_eligible, reason_code, rule_version
          )
          SELECT 'document', ${documentId}, true, true, true, false, true,
            'owner_authorized_official_scotus', 'official-scotus-publication-v1'
          WHERE NOT COALESCE((
            SELECT displayable FROM publication_decision
            WHERE object_type = 'document' AND object_id = ${documentId}
            ORDER BY decided_at DESC, id DESC LIMIT 1
          ), false)
        `;
      }

      await tx`
        UPDATE publication_review
        SET status = 'approved', reviewed_at = now(),
          reviewer_notes = 'Owner-authorized publication after exact official SCOTUS and readable CourtListener reconciliation.'
        WHERE ((object_type = 'legal_case' AND object_id = ${first.case_id})
          OR (object_type = 'document' AND object_id = ANY(${documentIds}::uuid[])))
          AND status IN ('pending', 'in_review', 'needs_changes')
      `;
      await tx`
        UPDATE official_opinion_candidate
        SET review_status = 'approved', reviewed_at = now(),
          reviewer_notes = 'Exact docket, filing date, caption, official PDF, and readable opinion match verified.'
        WHERE id = ${candidate.id}
      `;
      await tx`
        INSERT INTO outbox_event (
          topic, aggregate_type, aggregate_id, aggregate_version, payload
        ) VALUES (
          'publication.changed', 'legal_case', ${first.case_id},
          (extract(epoch from clock_timestamp()) * 1000000)::bigint,
          ${tx.json({
            source: "scotus_official",
            candidateId: candidate.id,
            sourceHash: candidate.source_content_hash,
            documentCount: documentIds.length,
          })}
        )
      `;
    });

    published += 1;
    publicRecords.push({ caseId: first.case_public_id, documentIds: documentPublicIds });
  }

  return { selected: candidates.length, published, held, publicRecords };
}
