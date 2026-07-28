import type postgres from "postgres";
import { createPublicId } from "@/lib/ids/public-id";

type Sql = ReturnType<typeof postgres>;

export function normalizeScotusCaption(value: string): string {
  return value
    .replace(/\\s+Revisions?\\s*:\\s*\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}\\s*$/i, "")
    .trim();
}

export function normalizeScotusIdentity(value: string): string {
  return normalizeScotusCaption(value)
    .toLowerCase()
    .replaceAll(/\bversus\b/g, "v")
    .replaceAll(/\bvs\.?\b/g, "v")
    .replaceAll(/[^a-z0-9]+/g, "");
}

export function isSameScotusCase(left: string, right: string): boolean {
  return normalizeScotusIdentity(left) === normalizeScotusIdentity(right);
}

export function expandScotusTermYear(termYear: string): number {
  if (!/^\d{2}$/.test(termYear)) throw new Error("Supreme Court term must be a two-digit year");
  return 2000 + Number(termYear);
}

interface Candidate {
  id: string;
  provider_id: string;
  source_record_id: string;
  opinion_artifact_id: string;
  docket_number: string;
  case_name: string;
  filed_on: string;
  term_year: string;
  citation: string | null;
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
    SELECT id, provider_id, source_record_id, opinion_artifact_id, docket_number, case_name,
      filed_on::text, term_year, citation, source_pdf_uri, source_content_hash
    FROM official_opinion_candidate
    WHERE review_status = 'pending_review'
      OR (
        review_status = 'approved'
        AND NOT EXISTS (
          SELECT 1 FROM document_identifier identifier
          WHERE identifier.provider_id = official_opinion_candidate.provider_id
            AND identifier.identifier_type = 'scotus_official_opinion'
            AND identifier.identifier_value = official_opinion_candidate.source_record_id
        )
      )
    ORDER BY filed_on, source_record_id
    LIMIT ${options.limit}
  `;

  let published = 0;
  let held = 0;
  const publicRecords: Array<{ caseId: string; documentIds: string[] }> = [];

  for (const candidate of candidates) {
    const normalizedCaseName = normalizeScotusCaption(candidate.case_name);
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
      isSameScotusCase(normalizedCaseName, match.case_caption) ||
      isSameScotusCase(normalizedCaseName, match.cluster_case_name)
    );
    const caseIds = new Set(compatible.map((match) => match.case_id));
    const clusterIds = new Set(compatible.map((match) => match.cluster_id));

    if (compatible.length === 0) {
      const metadataMatches = await sql<Array<{
        case_id: string;
        case_public_id: string;
        case_caption: string;
      }>>`
        SELECT legal_case.id AS case_id, legal_case.public_id AS case_public_id,
          legal_case.caption AS case_caption
        FROM legal_case
        JOIN court ON court.id = legal_case.court_id
        WHERE lower(regexp_replace(legal_case.docket_number, '[^a-zA-Z0-9]', '', 'g'))
          = lower(regexp_replace(${candidate.docket_number}, '[^a-zA-Z0-9]', '', 'g'))
          AND lower(court.provider_court_id) = 'scotus'
        ORDER BY legal_case.id
      `;
      const exactMetadataMatches = metadataMatches.filter((match) =>
        isSameScotusCase(normalizedCaseName, match.case_caption)
      );

      if (exactMetadataMatches.length > 1) {
        held += 1;
        await sql`
          UPDATE official_opinion_candidate
          SET reviewer_notes = 'Held: ambiguous canonical SCOTUS case metadata match',
            last_seen_at = now()
          WHERE id = ${candidate.id}
        `;
        continue;
      }

      const metadataCase = await sql.begin(async (tx) => {
        let existing = exactMetadataMatches[0];

        if (!existing) {
          const [court] = await tx<{ id: string }[]>`
            INSERT INTO court (
              public_id, provider_id, provider_court_id, name, short_name,
              verification, source_artifact_id
            ) VALUES (
              ${createPublicId("court")}, ${candidate.provider_id}, 'scotus',
              'Supreme Court of the United States', 'U.S. Supreme Court',
              'verified', ${candidate.opinion_artifact_id}
            )
            ON CONFLICT (provider_id, provider_court_id)
            DO UPDATE SET verification = 'verified',
              source_artifact_id = EXCLUDED.source_artifact_id, updated_at = now()
            RETURNING id
          `;
          if (!court) throw new Error("Official Supreme Court court record was not persisted");

          const [created] = await tx<{
            case_id: string;
            case_public_id: string;
            case_caption: string;
          }[]>`
            INSERT INTO legal_case (
              public_id, court_id, docket_number, caption, filed_on, decided_on,
              supreme_court_term, official_citation, verification, publication,
              source_artifact_id, source_updated_at
            ) VALUES (
              ${createPublicId("case")}, ${court.id}, ${candidate.docket_number},
              ${normalizedCaseName}, NULL, ${candidate.filed_on},
              ${expandScotusTermYear(candidate.term_year)}, ${candidate.citation}, 'verified', 'published',
              ${candidate.opinion_artifact_id}, now()
            )
            ON CONFLICT (court_id, docket_number)
            DO UPDATE SET caption = EXCLUDED.caption, decided_on = EXCLUDED.decided_on,
              supreme_court_term = EXCLUDED.supreme_court_term,
              official_citation = EXCLUDED.official_citation,
              verification = 'verified', publication = 'published',
              source_artifact_id = EXCLUDED.source_artifact_id,
              source_updated_at = EXCLUDED.source_updated_at, updated_at = now()
            RETURNING id AS case_id, public_id AS case_public_id, caption AS case_caption
          `;
          if (!created) throw new Error("Official Supreme Court case record was not persisted");
          existing = created;

          await tx`
            INSERT INTO case_identifier (
              case_id, provider_id, identifier_type, identifier_value
            ) VALUES (
              ${created.case_id}, ${candidate.provider_id},
              'scotus_official_opinion', ${candidate.source_record_id}
            )
            ON CONFLICT (provider_id, identifier_type, identifier_value)
            DO UPDATE SET case_id = EXCLUDED.case_id
          `;
        } else {
          await tx`
            UPDATE legal_case
            SET filed_on = NULL, decided_on = ${candidate.filed_on},
              supreme_court_term = ${expandScotusTermYear(candidate.term_year)},
              official_citation = ${candidate.citation}, verification = 'verified',
              publication = 'published', source_artifact_id = ${candidate.opinion_artifact_id},
              updated_at = now()
            WHERE id = ${existing.case_id}
          `;
        }

        await tx`
          INSERT INTO publication_decision (
            object_type, object_id, displayable, indexable, machine_accessible,
            downloadable, summary_eligible, reason_code, rule_version
          )
          SELECT 'legal_case', ${existing.case_id}, true, true, true, false, false,
            'verified_official_scotus_metadata', 'official-scotus-publication-v2'
          WHERE NOT COALESCE((
            SELECT displayable FROM publication_decision
            WHERE object_type = 'legal_case' AND object_id = ${existing.case_id}
            ORDER BY decided_at DESC, id DESC LIMIT 1
          ), false)
        `;
        await tx`
          UPDATE publication_review
          SET status = 'approved', reviewed_at = now(),
            reviewer_notes = 'Published from verified official Supreme Court metadata; opinion text remains separately gated.'
          WHERE object_type = 'legal_case' AND object_id = ${existing.case_id}
            AND status IN ('pending', 'in_review', 'needs_changes')
        `;
        const [cluster] = await tx<{ id: string }[]>`
          INSERT INTO opinion_cluster (
            public_id, case_id, provider_id, provider_cluster_id, case_name,
            date_filed, precedential_status, citation_count, citations,
            source_artifact_id, source_updated_at
          ) VALUES (
            ${createPublicId("cluster")}, ${existing.case_id}, ${candidate.provider_id},
            ${`official:${candidate.source_record_id}`}, ${normalizedCaseName},
            ${candidate.filed_on}, 'published', 0, '[]'::jsonb,
            ${candidate.opinion_artifact_id}, now()
          )
          ON CONFLICT (provider_id, provider_cluster_id)
          DO UPDATE SET case_id = EXCLUDED.case_id, case_name = EXCLUDED.case_name,
            date_filed = EXCLUDED.date_filed, source_artifact_id = EXCLUDED.source_artifact_id,
            source_updated_at = EXCLUDED.source_updated_at, updated_at = now()
          RETURNING id
        `;
        if (!cluster) throw new Error("Official Supreme Court opinion cluster was not persisted");

        const [existingDocument] = await tx<{ id: string; public_id: string }[]>`
          SELECT document.id, document.public_id
          FROM document_identifier identifier
          JOIN document ON document.id = identifier.document_id
          WHERE identifier.provider_id = ${candidate.provider_id}
            AND identifier.identifier_type = 'scotus_official_opinion'
            AND identifier.identifier_value = ${candidate.source_record_id}
          LIMIT 1
        `;
        const [document] = existingDocument ? [existingDocument] : await tx<{ id: string; public_id: string }[]>`
          INSERT INTO document (
            public_id, case_id, document_type, title, filed_on, content_hash,
            source_artifact_id, publication, extraction_confidence
          ) VALUES (
            ${createPublicId("document")}, ${existing.case_id}, 'judicial_opinion',
            ${`${normalizedCaseName} opinion`}, ${candidate.filed_on},
            ${candidate.source_content_hash}, ${candidate.opinion_artifact_id},
            'published', NULL
          )
          RETURNING id, public_id
        `;
        if (!document) throw new Error("Official Supreme Court PDF document was not persisted");
        await tx`UPDATE document SET publication = 'published', updated_at = now() WHERE id = ${document.id}`;
        await tx`
          INSERT INTO document_identifier (document_id, provider_id, identifier_type, identifier_value)
          VALUES (${document.id}, ${candidate.provider_id}, 'scotus_official_opinion', ${candidate.source_record_id})
          ON CONFLICT (provider_id, identifier_type, identifier_value)
          DO UPDATE SET document_id = EXCLUDED.document_id
        `;
        await tx`
          INSERT INTO judicial_opinion (
            cluster_id, document_id, provider_id, provider_opinion_id, opinion_type,
            author_name, per_curiam, source_download_url, source_artifact_id
          ) VALUES (
            ${cluster.id}, ${document.id}, ${candidate.provider_id}, ${candidate.source_record_id},
            'majority', NULL, false, ${candidate.source_pdf_uri}, ${candidate.opinion_artifact_id}
          )
          ON CONFLICT (provider_id, provider_opinion_id)
          DO UPDATE SET cluster_id = EXCLUDED.cluster_id, document_id = EXCLUDED.document_id,
            source_download_url = EXCLUDED.source_download_url,
            source_artifact_id = EXCLUDED.source_artifact_id, updated_at = now()
        `;
        await tx`
          INSERT INTO publication_decision (
            object_type, object_id, displayable, indexable, machine_accessible,
            downloadable, summary_eligible, reason_code, rule_version
          )
          SELECT 'document', ${document.id}, true, true, true, true, false,
            'verified_official_scotus_pdf', 'official-scotus-publication-v3'
          WHERE NOT COALESCE((
            SELECT displayable FROM publication_decision
            WHERE object_type = 'document' AND object_id = ${document.id}
            ORDER BY decided_at DESC, id DESC LIMIT 1
          ), false)
        `;
        await tx`
          UPDATE official_opinion_candidate
          SET review_status = 'approved', reviewed_at = now(),
            reviewer_notes = 'Verified official Supreme Court metadata and authoritative PDF published; text extraction remains pending.'
          WHERE id = ${candidate.id}
        `;
        await tx`
          INSERT INTO outbox_event (
            topic, aggregate_type, aggregate_id, aggregate_version, payload
          ) VALUES (
            'publication.changed', 'legal_case', ${existing.case_id},
            (extract(epoch from clock_timestamp()) * 1000000)::bigint,
            ${tx.json({
              source: "scotus_official",
              candidateId: candidate.id,
              sourceHash: candidate.source_content_hash,
              documentCount: 1,
              metadataOnly: false,
              textExtractionPending: true,
            })}
          )
        `;
        return { ...existing, documentPublicId: document.public_id };
      });

      published += 1;
      publicRecords.push({ caseId: metadataCase.case_public_id, documentIds: [metadataCase.documentPublicId] });
      continue;
    }

    if (caseIds.size !== 1 || clusterIds.size !== 1) {
      held += 1;
      await sql`
        UPDATE official_opinion_candidate
        SET reviewer_notes = 'Held: ambiguous canonical case or opinion-cluster match',
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
        SET decided_on = ${candidate.filed_on},
          supreme_court_term = ${expandScotusTermYear(candidate.term_year)},
          official_citation = ${candidate.citation}, verification = 'verified',
          publication = 'published', updated_at = now()
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
