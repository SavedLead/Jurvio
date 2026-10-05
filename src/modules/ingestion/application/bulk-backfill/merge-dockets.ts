import type postgres from "postgres";
import { createPublicId } from "@/lib/ids/public-id";
import type { CourtListenerBulkDocket } from "../../providers/courtlistener/bulk-dockets";
import { bulkDate, bulkDocketNumber, bulkTimestamp, cleanOptionalText, cleanText } from "./bulk-values";
import type { BatchOutcome } from "./stage-runner";

export interface DocketBatchRow {
  docket_id: string;
  court_code: string;
  docket_number: string;
  provider_scoped: boolean;
  caption: string;
  filed_on: string | null;
  terminated_on: string | null;
  nature_of_suit: string | null;
  cause: string | null;
  source_updated_at: string | null;
  public_id: string;
}

export function docketBatchRow(docket: CourtListenerBulkDocket): DocketBatchRow {
  const { docketNumber, providerScoped } = bulkDocketNumber(docket.id, docket.docket_number);
  return {
    docket_id: docket.id,
    court_code: docket.court_id,
    docket_number: docketNumber,
    provider_scoped: providerScoped,
    caption: cleanText(docket.case_name || docket.case_name_full || docket.case_name_short || "").trim(),
    filed_on: bulkDate(docket.date_filed),
    terminated_on: bulkDate(docket.date_terminated),
    nature_of_suit: cleanOptionalText(docket.nature_of_suit),
    cause: cleanOptionalText(docket.cause),
    source_updated_at: bulkTimestamp(docket.date_modified),
    public_id: createPublicId("case"),
  };
}

/**
 * Merge one batch of CourtListener dockets into legal_case + case_identifier.
 *
 * Each docket resolves to a case in order of confidence: its existing
 * courtlistener_docket_id identifier; else exactly one case in the same court whose
 * docket number matches after dropping punctuation and case; else the exact
 * (court, docket_number) key, inserting when absent. Existing cases only gain
 * data (a longer caption, missing dates, newer termination/NOS/cause); their
 * source artifact, publication and verification state are never replaced.
 *
 * Unlike the per-row lanes this writes no outbox event or publication review per
 * docket: tens of millions of bare dockets would flood both queues, and the
 * publication loops already discover drafts from legal_case directly.
 */
export async function mergeDocketBatch(
  tx: postgres.TransactionSql,
  context: { providerId: string; artifactId: string },
  rows: readonly DocketBatchRow[],
): Promise<BatchOutcome & { inserted: number; heldUnknownCourt: number }> {
  const unique = [...new Map(rows.map((row) => [row.docket_id, row])).values()];
  await tx`
    CREATE TEMP TABLE IF NOT EXISTS bulk_docket_batch (
      docket_id text PRIMARY KEY,
      court_code text NOT NULL,
      docket_number text NOT NULL,
      provider_scoped boolean NOT NULL,
      caption text NOT NULL,
      filed_on date,
      terminated_on date,
      nature_of_suit text,
      cause text,
      source_updated_at timestamptz,
      public_id text NOT NULL,
      court_id uuid,
      case_id uuid,
      matched_by text
    ) ON COMMIT DELETE ROWS
  `;
  await tx`
    INSERT INTO bulk_docket_batch (
      docket_id, court_code, docket_number, provider_scoped, caption, filed_on,
      terminated_on, nature_of_suit, cause, source_updated_at, public_id
    )
    SELECT docket_id, court_code, docket_number, provider_scoped, caption, filed_on,
      terminated_on, nature_of_suit, cause, source_updated_at, public_id
    FROM jsonb_to_recordset(${tx.json(unique as unknown as postgres.JSONValue)}) AS r(
      docket_id text, court_code text, docket_number text, provider_scoped boolean,
      caption text, filed_on date, terminated_on date, nature_of_suit text, cause text,
      source_updated_at timestamptz, public_id text
    )
  `;
  await tx`
    UPDATE bulk_docket_batch b SET court_id = court.id
    FROM court
    WHERE court.provider_id = ${context.providerId} AND court.provider_court_id = b.court_code
  `;
  await tx`
    UPDATE bulk_docket_batch b SET case_id = identifier.case_id, matched_by = 'identifier'
    FROM case_identifier identifier
    WHERE b.court_id IS NOT NULL
      AND identifier.provider_id = ${context.providerId}
      AND identifier.identifier_type = 'courtlistener_docket_id'
      AND identifier.identifier_value = b.docket_id
  `;
  await tx`
    UPDATE bulk_docket_batch b SET case_id = single.case_id, matched_by = 'normalized_docket'
    FROM (
      SELECT pending.docket_id, (array_agg(legal_case.id))[1] AS case_id
      FROM bulk_docket_batch pending
      JOIN legal_case ON legal_case.court_id = pending.court_id
        AND lower(regexp_replace(legal_case.docket_number, '[^a-zA-Z0-9]', '', 'g'))
          = lower(regexp_replace(pending.docket_number, '[^a-zA-Z0-9]', '', 'g'))
      WHERE pending.case_id IS NULL AND pending.court_id IS NOT NULL
        AND NOT pending.provider_scoped
        AND regexp_replace(pending.docket_number, '[^a-zA-Z0-9]', '', 'g') <> ''
      GROUP BY pending.docket_id
      HAVING count(*) = 1
    ) single
    WHERE b.docket_id = single.docket_id
  `;
  await tx`
    UPDATE legal_case SET
      caption = CASE WHEN length(b.caption) > length(legal_case.caption)
        THEN b.caption ELSE legal_case.caption END,
      filed_on = COALESCE(legal_case.filed_on, b.filed_on),
      terminated_on = COALESCE(b.terminated_on, legal_case.terminated_on),
      nature_of_suit_code = COALESCE(b.nature_of_suit, legal_case.nature_of_suit_code),
      cause_of_action = COALESCE(b.cause, legal_case.cause_of_action),
      source_artifact_id = COALESCE(legal_case.source_artifact_id, ${context.artifactId}::uuid),
      source_updated_at = GREATEST(legal_case.source_updated_at, b.source_updated_at),
      updated_at = now()
    FROM (
      SELECT DISTINCT ON (case_id) *
      FROM bulk_docket_batch
      WHERE case_id IS NOT NULL
      ORDER BY case_id, length(caption) DESC, docket_id
    ) b
    WHERE legal_case.id = b.case_id AND (
      length(b.caption) > length(legal_case.caption)
      OR (legal_case.filed_on IS NULL AND b.filed_on IS NOT NULL)
      OR (b.terminated_on IS NOT NULL AND b.terminated_on IS DISTINCT FROM legal_case.terminated_on)
      OR (b.nature_of_suit IS NOT NULL AND b.nature_of_suit IS DISTINCT FROM legal_case.nature_of_suit_code)
      OR (b.cause IS NOT NULL AND b.cause IS DISTINCT FROM legal_case.cause_of_action)
      OR legal_case.source_artifact_id IS NULL
      OR b.source_updated_at > COALESCE(legal_case.source_updated_at, '-infinity'::timestamptz)
    )
  `;
  await tx`
    WITH fresh AS (
      SELECT DISTINCT ON (court_id, docket_number) *
      FROM bulk_docket_batch
      WHERE case_id IS NULL AND court_id IS NOT NULL
      ORDER BY court_id, docket_number, docket_id
    ), upserted AS (
      INSERT INTO legal_case (
        public_id, court_id, docket_number, caption, filed_on, terminated_on,
        nature_of_suit_code, cause_of_action, verification, publication,
        source_artifact_id, source_updated_at
      )
      SELECT public_id, court_id, docket_number, caption, filed_on, terminated_on,
        nature_of_suit, cause, 'not_verified', 'draft', ${context.artifactId}::uuid,
        source_updated_at
      FROM fresh
      ON CONFLICT (court_id, docket_number) WHERE supreme_court_term IS NULL
      DO UPDATE SET
        caption = CASE WHEN length(EXCLUDED.caption) > length(legal_case.caption)
          THEN EXCLUDED.caption ELSE legal_case.caption END,
        filed_on = COALESCE(legal_case.filed_on, EXCLUDED.filed_on),
        terminated_on = COALESCE(EXCLUDED.terminated_on, legal_case.terminated_on),
        nature_of_suit_code = COALESCE(EXCLUDED.nature_of_suit_code, legal_case.nature_of_suit_code),
        cause_of_action = COALESCE(EXCLUDED.cause_of_action, legal_case.cause_of_action),
        source_artifact_id = COALESCE(legal_case.source_artifact_id, EXCLUDED.source_artifact_id),
        source_updated_at = GREATEST(legal_case.source_updated_at, EXCLUDED.source_updated_at),
        updated_at = now()
      RETURNING id, court_id, docket_number, (xmax = 0) AS created
    )
    UPDATE bulk_docket_batch b SET
      case_id = upserted.id,
      matched_by = CASE WHEN upserted.created THEN 'inserted' ELSE 'docket_number' END
    FROM upserted
    WHERE b.case_id IS NULL AND b.court_id = upserted.court_id
      AND b.docket_number = upserted.docket_number
  `;
  await tx`
    INSERT INTO case_identifier (case_id, provider_id, identifier_type, identifier_value)
    SELECT case_id, ${context.providerId}, 'courtlistener_docket_id', docket_id
    FROM bulk_docket_batch
    WHERE case_id IS NOT NULL
    ON CONFLICT (provider_id, identifier_type, identifier_value)
    DO UPDATE SET case_id = EXCLUDED.case_id
    WHERE case_identifier.case_id IS DISTINCT FROM EXCLUDED.case_id
  `;
  const [summary] = await tx<{ matched: number; inserted: number; held_unknown_court: number }[]>`
    SELECT
      count(*) FILTER (WHERE case_id IS NOT NULL)::int AS matched,
      count(*) FILTER (WHERE matched_by = 'inserted')::int AS inserted,
      count(*) FILTER (WHERE court_id IS NULL)::int AS held_unknown_court
    FROM bulk_docket_batch
  `;
  return {
    matched: summary?.matched ?? 0,
    written: summary?.matched ?? 0,
    inserted: summary?.inserted ?? 0,
    heldUnknownCourt: summary?.held_unknown_court ?? 0,
  };
}
