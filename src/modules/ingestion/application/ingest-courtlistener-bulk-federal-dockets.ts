import type postgres from "postgres";
import { createPublicId } from "@/lib/ids/public-id";
import {
  bulkDocketContentHash,
  bulkDocketSourceUri,
  readBulkDockets,
} from "../providers/courtlistener/bulk-dockets";

type Sql = ReturnType<typeof postgres>;

export interface BulkFederalDocketOptions {
  filePath: string;
  snapshotDate: string;
  year: number;
  includeBankruptcy: boolean;
  rowLimit?: number;
}

function isFederalJurisdiction(value: string | null, includeBankruptcy: boolean): boolean {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (normalized === "f" || normalized === "fd" || normalized === "federal") return true;
  if (normalized.includes("federal district") || normalized.includes("federal appellate")) return true;
  return includeBankruptcy && (normalized === "fb" || normalized.includes("bankruptcy"));
}

function safeDate(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

export async function ingestCourtListenerBulkFederalDockets(
  sql: Sql,
  options: BulkFederalDocketOptions,
) {
  if (!Number.isInteger(options.year) || options.year < 1900 || options.year > 2100) {
    throw new Error("Bulk federal docket year must be 1900-2100");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.snapshotDate)) {
    throw new Error("Bulk snapshot date must be YYYY-MM-DD");
  }

  const [provider] = await sql<{ id: string }[]>`
    SELECT id FROM provider WHERE code = 'courtlistener'
  `;
  if (!provider) throw new Error("CourtListener provider seed is missing");

  let rowsRead = 0;
  let accepted = 0;
  let heldWrongYear = 0;
  let heldNonFederal = 0;
  let heldMissingIdentity = 0;
  let failed = 0;
  const errors: Array<{ docketId: string; error: string }> = [];

  for await (const docket of readBulkDockets(options.filePath)) {
    rowsRead += 1;
    if (options.rowLimit && rowsRead > options.rowLimit) break;

    const filedOn = safeDate(docket.date_filed);
    if (!filedOn || Number(filedOn.slice(0, 4)) !== options.year) {
      heldWrongYear += 1;
      continue;
    }
    if (!docket.docket_number.trim() || !docket.case_name.trim()) {
      heldMissingIdentity += 1;
      continue;
    }

    const [court] = await sql<{ id: string; jurisdiction: string | null }[]>`
      SELECT id, jurisdiction FROM court
      WHERE provider_id = ${provider.id} AND provider_court_id = ${docket.court_id}
    `;
    if (!court || !isFederalJurisdiction(court.jurisdiction, options.includeBankruptcy)) {
      heldNonFederal += 1;
      continue;
    }

    try {
      const sourceUri = bulkDocketSourceUri(options.snapshotDate, docket.id);
      const contentHash = bulkDocketContentHash(docket);
      await sql.begin(async (tx) => {
        const [artifact] = await tx<{ id: string }[]>`
          INSERT INTO raw_artifact (
            provider_id, source_uri, source_record_id, content_hash, object_key,
            media_type, retrieved_at, response_metadata
          ) VALUES (
            ${provider.id}, ${sourceUri}, ${docket.id}, ${contentHash},
            ${`courtlistener/bulk/${options.snapshotDate}/dockets.csv.bz2`},
            'text/csv', ${options.snapshotDate},
            ${tx.json({ source: "courtlistener_bulk", snapshotDate: options.snapshotDate })}
          )
          ON CONFLICT (provider_id, source_uri, content_hash)
          DO UPDATE SET retrieved_at = EXCLUDED.retrieved_at
          RETURNING id
        `;
        if (!artifact) throw new Error("Bulk docket artifact was not persisted");

        await tx`
          UPDATE court SET verification = 'verified', updated_at = now()
          WHERE id = ${court.id} AND verification <> 'verified'
        `;

        const [legalCase] = await tx<{ id: string; public_id: string }[]>`
          INSERT INTO legal_case (
            public_id, court_id, docket_number, caption, filed_on, terminated_on,
            nature_of_suit_code, cause_of_action, verification, publication,
            source_artifact_id, source_updated_at
          ) VALUES (
            ${createPublicId("case")}, ${court.id}, ${docket.docket_number.trim()},
            ${docket.case_name.trim()}, ${filedOn}, ${safeDate(docket.date_terminated)},
            ${docket.nature_of_suit || null}, ${docket.cause || null},
            'not_verified', 'draft', ${artifact.id}, ${docket.date_modified}
          )
          ON CONFLICT (court_id, docket_number)
          DO UPDATE SET
            caption = EXCLUDED.caption,
            filed_on = COALESCE(EXCLUDED.filed_on, legal_case.filed_on),
            terminated_on = COALESCE(EXCLUDED.terminated_on, legal_case.terminated_on),
            nature_of_suit_code = COALESCE(EXCLUDED.nature_of_suit_code, legal_case.nature_of_suit_code),
            cause_of_action = COALESCE(EXCLUDED.cause_of_action, legal_case.cause_of_action),
            source_artifact_id = EXCLUDED.source_artifact_id,
            source_updated_at = EXCLUDED.source_updated_at,
            updated_at = now()
          RETURNING id, public_id
        `;
        if (!legalCase) throw new Error("Bulk federal case was not persisted");

        await tx`
          INSERT INTO case_identifier (
            case_id, provider_id, identifier_type, identifier_value
          ) VALUES (
            ${legalCase.id}, ${provider.id}, 'courtlistener_docket_id', ${docket.id}
          )
          ON CONFLICT (provider_id, identifier_type, identifier_value)
          DO UPDATE SET case_id = EXCLUDED.case_id
        `;

        await tx`
          INSERT INTO outbox_event (
            topic, aggregate_type, aggregate_id, aggregate_version, payload
          ) VALUES (
            'case.changed', 'legal_case', ${legalCase.id},
            (extract(epoch from clock_timestamp()) * 1000000)::bigint,
            ${tx.json({
              caseId: legalCase.public_id,
              source: "courtlistener_bulk",
              snapshotDate: options.snapshotDate,
              year: options.year,
            })}
          )
        `;
      });
      accepted += 1;
    } catch (error) {
      failed += 1;
      if (errors.length < 100) {
        errors.push({
          docketId: docket.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const checkpoint = JSON.stringify({
    version: 1,
    snapshotDate: options.snapshotDate,
    year: options.year,
    rowsRead,
    completed: !options.rowLimit,
  });
  await sql`
    INSERT INTO ingestion_checkpoint (provider_id, stream_name, cursor_value)
    VALUES (
      ${provider.id}, ${`bulk:federal-dockets:${options.snapshotDate}:${options.year}`},
      ${checkpoint}
    )
    ON CONFLICT (provider_id, stream_name)
    DO UPDATE SET cursor_value = EXCLUDED.cursor_value, updated_at = now()
  `;

  return {
    snapshotDate: options.snapshotDate,
    year: options.year,
    rowsRead,
    accepted,
    heldWrongYear,
    heldNonFederal,
    heldMissingIdentity,
    failed,
    errors,
  };
}
