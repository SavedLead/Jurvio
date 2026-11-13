import type postgres from "postgres";
import { createPublicId } from "@/lib/ids/public-id";
import type { ArtifactStore } from "./artifact-store";
import { entryImportance, fetchOfficialDocket } from "../providers/scotus/official-docket";
import { extractQuestionPresentedFromPdf, fetchOfficialFilingPdf } from "../providers/scotus/official-filing";

type Sql = ReturnType<typeof postgres>;

interface CaseRow { id: string; public_id: string; docket_number: string; }

function dispositionScope(value: string) {
  const text = value.toLowerCase();
  if (text.includes("reversed") && text.includes("remanded")) return "reversed_and_remanded";
  if (text.includes("vacated") && text.includes("remanded")) return "vacated_and_remanded";
  if (text.includes("affirmed")) return "affirmed";
  if (text.includes("dismissed")) return "dismissed";
  return null;
}


export async function ingestOfficialScotusDockets(
  sql: Sql,
  artifactStore: ArtifactStore,
  options: { limit: number; caseId?: string; skipPdfs?: boolean },
) {
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100) throw new Error("Docket limit must be between 1 and 100");
  const [provider] = await sql<{ id: string }[]>`SELECT id FROM provider WHERE code = 'scotus_official'`;
  if (!provider) throw new Error("Official Supreme Court provider seed is missing");
  const cases = await sql<CaseRow[]>`
    SELECT legal_case.id, legal_case.public_id, legal_case.docket_number
    FROM legal_case JOIN court ON court.id = legal_case.court_id
    LEFT JOIN scotus_case_enrichment enrichment ON enrichment.case_id = legal_case.id
    WHERE lower(court.provider_court_id) = 'scotus'
      AND (${options.caseId ?? null}::uuid IS NULL OR legal_case.id = ${options.caseId ?? null}::uuid)
      AND (
        (${options.caseId ?? null}::uuid IS NOT NULL)
        OR EXISTS (SELECT 1 FROM followed_item_priority priority WHERE priority.case_id = legal_case.id
          AND (enrichment.case_id IS NULL OR enrichment.updated_at < now() - interval '30 minutes'))
        OR enrichment.case_id IS NULL
        OR enrichment.updated_at < now() - interval '24 hours'
        OR (((enrichment.completeness->>'docketEvents') IS DISTINCT FROM 'true'
          OR (enrichment.completeness->>'docketDocuments') IS DISTINCT FROM 'true')
          AND enrichment.updated_at < now() - interval '5 minutes')
      )
    ORDER BY EXISTS (SELECT 1 FROM followed_item_priority priority WHERE priority.case_id = legal_case.id) DESC,
      enrichment.updated_at NULLS FIRST, legal_case.decided_on DESC NULLS LAST, legal_case.id
    LIMIT ${options.limit}
  `;
  let succeeded = 0;
  let held = 0;
  let skipped = 0;
  let eventsPublished = 0;
  let documentsPublished = 0;
  const publicRecords: Array<{ caseId: string; events: number; documents: number }> = [];
  for (const legalCase of cases) {
    // The official_docket_url CHECK constraint (migrations 0019/0020) only accepts a
    // docket number matching [0-9A-Za-z-]+. A case with any other docket number (common
    // in historical bound-volume cases) would violate the constraint in BOTH the success
    // and the error-handler inserts below, crashing the lane. Skip it here instead.
    if (!/^[0-9A-Za-z-]+$/.test(legalCase.docket_number ?? "")) { skipped += 1; continue; }
    try {
      const docket = await fetchOfficialDocket(legalCase.docket_number);
      const stored = await artifactStore.putIfAbsent({ key: `scotus/dockets/${legalCase.docket_number}/${docket.contentHash}.html`,
        mediaType: "text/html", body: docket.rawBody, contentHash: docket.contentHash });
      const [artifact] = await sql<{ id: string }[]>`
        INSERT INTO raw_artifact (provider_id, source_uri, source_record_id, content_hash, object_key,
          media_type, retrieved_at, response_metadata)
        VALUES (${provider.id}, ${docket.sourceUri}, ${`docket:${legalCase.docket_number}`}, ${docket.contentHash},
          ${stored.objectKey}, 'text/html', ${docket.retrievedAt}, ${sql.json({ docketNumber: legalCase.docket_number, eventCount: docket.events.length })})
        ON CONFLICT (provider_id, source_uri, content_hash) DO UPDATE SET retrieved_at = EXCLUDED.retrieved_at
        RETURNING id
      `;
      if (!artifact) throw new Error("Official docket artifact was not persisted");
      let caseEvents = 0;
      let caseDocuments = 0;
      let questionPresented: string | null = null;
      let questionSourceUrl: string | null = null;
      const petition = options.skipPdfs ? undefined : docket.events.flatMap((event) => event.documents).find((document) => document.documentType === "petition");
      if (petition) {
        try {
          const pdf = await fetchOfficialFilingPdf(petition.url);
          const petitionStored = await artifactStore.putIfAbsent({ key: `scotus/dockets/${legalCase.docket_number}/petition-${pdf.contentHash}.pdf`,
            mediaType: "application/pdf", body: pdf.body, contentHash: pdf.contentHash });
          await sql`
            INSERT INTO raw_artifact (provider_id, source_uri, source_record_id, content_hash, object_key,
              media_type, retrieved_at, response_metadata)
            VALUES (${provider.id}, ${pdf.sourceUri}, ${petition.sourceRecordId}, ${pdf.contentHash},
              ${petitionStored.objectKey}, 'application/pdf', ${pdf.retrievedAt}, ${sql.json({ docketNumber: legalCase.docket_number, documentType: "petition" })})
            ON CONFLICT (provider_id, source_uri, content_hash) DO UPDATE SET retrieved_at = EXCLUDED.retrieved_at
          `;
          questionPresented = await extractQuestionPresentedFromPdf(pdf.body);
          questionSourceUrl = questionPresented ? pdf.sourceUri : null;
        } catch (error) {
          console.error(JSON.stringify({ caseId: legalCase.public_id, petitionHeld: error instanceof Error ? error.message : "Petition extraction failed" }));
        }
      }
      await sql.begin(async (tx) => {
        const decisionEvent = [...docket.events].reverse().find((event) => event.eventType === "decision");
        const exactDisposition = decisionEvent?.description ?? null;
        const scope = exactDisposition ? dispositionScope(exactDisposition) : null;
        const perCuriam = docket.events.some((event) => /opinion\s+per\s+curiam/i.test(event.description));
        await tx`
          INSERT INTO scotus_case_enrichment (case_id, official_docket_url, docket_source_artifact_id,
            docketed_on, lower_court_name, lower_court_case_numbers, lower_court_decided_on,
            question_presented, question_source_url, question_source_locator, exact_disposition, disposition_source_url, disposition_source_locator,
            decision_lineup, completeness, verification, parser_version, verified_at)
          VALUES (${legalCase.id}, ${docket.sourceUri}, ${artifact.id}, ${docket.docketedOn}, ${docket.lowerCourtName},
            ${tx.json(docket.lowerCourtCaseNumbers)}, ${docket.lowerCourtDecidedOn}, ${questionPresented},
            ${questionSourceUrl}, ${questionPresented ? "Petition PDF: Question Presented" : null}, ${exactDisposition},
            ${exactDisposition ? docket.sourceUri : null}, ${exactDisposition ? `Proceedings and Orders: ${decisionEvent?.filedOn}` : null},
            ${tx.json({ perCuriam })}, ${tx.json({ docketEvents: true, docketDocuments: true, eventCount: docket.events.length })},
            'verified', 'official-scotus-docket-v1', now())
          ON CONFLICT (case_id) DO UPDATE SET official_docket_url = EXCLUDED.official_docket_url,
            docket_source_artifact_id = EXCLUDED.docket_source_artifact_id, docketed_on = EXCLUDED.docketed_on,
            lower_court_name = EXCLUDED.lower_court_name, lower_court_case_numbers = EXCLUDED.lower_court_case_numbers,
            lower_court_decided_on = EXCLUDED.lower_court_decided_on,
            question_presented = COALESCE(EXCLUDED.question_presented, scotus_case_enrichment.question_presented),
            question_source_url = COALESCE(EXCLUDED.question_source_url, scotus_case_enrichment.question_source_url),
            question_source_locator = COALESCE(EXCLUDED.question_source_locator, scotus_case_enrichment.question_source_locator),
            exact_disposition = EXCLUDED.exact_disposition,
            disposition_source_url = EXCLUDED.disposition_source_url,
            disposition_source_locator = EXCLUDED.disposition_source_locator,
            decision_lineup = scotus_case_enrichment.decision_lineup || EXCLUDED.decision_lineup,
            completeness = scotus_case_enrichment.completeness || EXCLUDED.completeness,
            verification = 'verified', parser_version = EXCLUDED.parser_version, verified_at = now(), updated_at = now()
        `;
        if (scope) await tx`UPDATE legal_case SET disposition_scope = ${scope}, updated_at = now() WHERE id = ${legalCase.id}`;
        if (perCuriam) await tx`
          UPDATE judicial_opinion SET per_curiam = true, author_name = NULL, updated_at = now()
          WHERE document_id IN (SELECT id FROM document WHERE case_id = ${legalCase.id})
        `;
        for (const [index, event] of docket.events.entries()) {
          const [entry] = await tx<{ id: string }[]>`
            INSERT INTO docket_entry (public_id, case_id, provider_id, provider_entry_id, entry_number,
              filed_on, description, entry_type, importance, source_artifact_id)
            VALUES (${createPublicId("docketEntry")}, ${legalCase.id}, ${provider.id}, ${event.sourceRecordId},
              ${String(index + 1)}, ${event.filedOn}, ${event.description}, ${event.eventType}, ${entryImportance(event.eventType, event.description, docket.docketNumber)}, ${artifact.id})
            ON CONFLICT (provider_id, provider_entry_id) DO UPDATE SET filed_on = EXCLUDED.filed_on,
              description = EXCLUDED.description, entry_type = EXCLUDED.entry_type,
              importance = EXCLUDED.importance, source_artifact_id = EXCLUDED.source_artifact_id, updated_at = now()
            RETURNING id
          `;
          if (!entry) throw new Error("Official docket event was not persisted");
          await tx`
            INSERT INTO publication_decision (object_type, object_id, displayable, indexable, machine_accessible,
              downloadable, summary_eligible, reason_code, rule_version)
            SELECT 'docket_entry', ${entry.id}, true, true, true, false, false,
              'verified_official_scotus_docket', 'official-scotus-docket-v1'
            WHERE NOT EXISTS (
              SELECT 1 FROM publication_decision existing
              WHERE existing.object_type = 'docket_entry' AND existing.object_id = ${entry.id}
            )
          `;
          caseEvents += 1;
          for (const filing of event.documents) {
            const [existing] = await tx<{ id: string }[]>`
              SELECT document.id FROM document_identifier identifier JOIN document ON document.id = identifier.document_id
              WHERE identifier.provider_id = ${provider.id} AND identifier.identifier_type = 'scotus_docket_document'
                AND identifier.identifier_value = ${filing.sourceRecordId} LIMIT 1
            `;
            const [document] = existing ? [existing] : await tx<{ id: string }[]>`
              INSERT INTO document (public_id, case_id, docket_entry_id, document_type, title, filed_on,
                source_artifact_id, publication)
              VALUES (${createPublicId("document")}, ${legalCase.id}, ${entry.id}, ${filing.documentType},
                ${filing.title}, ${filing.filedOn}, ${artifact.id}, 'published') RETURNING id
            `;
            if (!document) throw new Error("Official docket document was not persisted");
            await tx`
              INSERT INTO document_identifier (document_id, provider_id, identifier_type, identifier_value)
              VALUES (${document.id}, ${provider.id}, 'scotus_docket_document', ${filing.sourceRecordId})
              ON CONFLICT (provider_id, identifier_type, identifier_value) DO UPDATE SET document_id = EXCLUDED.document_id
            `;
            await tx`
              INSERT INTO scotus_docket_document (document_id, source_url, source_record_id, source_artifact_id)
              VALUES (${document.id}, ${filing.url}, ${filing.sourceRecordId}, ${artifact.id})
              ON CONFLICT (document_id) DO UPDATE SET source_url = EXCLUDED.source_url,
                source_artifact_id = EXCLUDED.source_artifact_id, verified_at = now()
            `;
            await tx`
              INSERT INTO publication_decision (object_type, object_id, displayable, indexable, machine_accessible,
                downloadable, summary_eligible, reason_code, rule_version)
              SELECT 'document', ${document.id}, true, true, true, true, false,
                'verified_official_scotus_docket_document', 'official-scotus-docket-v1'
              WHERE NOT EXISTS (
                SELECT 1 FROM publication_decision existing
                WHERE existing.object_type = 'document' AND existing.object_id = ${document.id}
              )
            `;
            caseDocuments += 1;
          }
        }
      });
      succeeded += 1;
      eventsPublished += caseEvents;
      documentsPublished += caseDocuments;
      publicRecords.push({ caseId: legalCase.public_id, events: caseEvents, documents: caseDocuments });
    } catch (error) {
      held += 1;
      const heldReason = error instanceof Error ? error.message : "Official docket ingestion failed";
      await sql`
        INSERT INTO scotus_case_enrichment (
          case_id, official_docket_url, completeness, verification, parser_version, verified_at
        ) VALUES (
          ${legalCase.id},
          ${`https://www.supremecourt.gov/docket/docketfiles/html/public/${legalCase.docket_number}.html`},
          ${sql.json({ docketChecked: true, docketUnavailable: true, docketUnavailableReason: heldReason })},
          'verified', 'official-scotus-docket-v1', now()
        )
        ON CONFLICT (case_id) DO UPDATE SET
          completeness = scotus_case_enrichment.completeness || EXCLUDED.completeness,
          updated_at = now()
      `;
      console.error(JSON.stringify({ caseId: legalCase.public_id, docketNumber: legalCase.docket_number,
        held: error instanceof Error ? error.message : "Official docket ingestion failed" }));
    }
  }
  return { selected: cases.length, succeeded, held, skipped, eventsPublished, documentsPublished, publicRecords };
}
