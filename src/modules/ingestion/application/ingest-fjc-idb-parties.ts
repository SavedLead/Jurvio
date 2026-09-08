import type postgres from "postgres";
import { createPublicId } from "@/lib/ids/public-id";
import {
  fjcIdbCaseKey,
  fjcIdbContentHash,
  fjcIdbParties,
  fjcIdbSourceUri,
  readFjcIdbRows,
  type FjcIdbRow,
} from "../providers/courtlistener/bulk-fjc-idb";

type Sql = ReturnType<typeof postgres>;

export interface FjcIdbPartyBackfillOptions {
  filePath: string;
  /** Snapshot date of the CourtListener bulk file, YYYY-MM-DD. */
  snapshotDate: string;
  /** Restrict the run to one filing year. Chunks a multi-million-row file. */
  filingYear?: number;
  rowLimit?: number;
  batchSize?: number;
}

export interface FjcIdbPartyBackfillResult {
  rowsRead: number;
  unusableRows: number;
  skippedOtherYear: number;
  unmatchedCases: number;
  matchedCases: number;
  entitiesCreated: number;
  appearancesWritten: number;
  failed: number;
  errors: Array<{ rowId: string; error: string }>;
}

const DEFAULT_BATCH_SIZE = 500;

interface CaseMatch {
  caseId: string;
  courtCode: string;
  docketCore: string;
  docketOffice: string | null;
  filedYear: number | null;
}

/**
 * Resolve a batch of IDB case keys to our own cases in one indexed query.
 *
 * Matching on (district, docket core) is what the
 * legal_case_federal_docket_core_idx expression index serves. Office and filing
 * year are returned rather than filtered here so the caller can reject a
 * near-miss explicitly and count it, instead of a mismatch silently looking the
 * same as a case we simply do not carry.
 */
async function findCases(
  sql: Sql,
  keys: Array<{ districtCode: string; docketCore: string }>,
): Promise<Map<string, CaseMatch[]>> {
  if (keys.length === 0) return new Map();
  const districtCodes = keys.map((key) => key.districtCode);
  const docketCores = keys.map((key) => key.docketCore);

  const rows = await sql<CaseMatch[]>`
    SELECT legal_case.id AS "caseId", want.court_code AS "courtCode",
      want.docket_core AS "docketCore",
      federal_docket_office(legal_case.docket_number) AS "docketOffice",
      extract(year FROM legal_case.filed_on)::int AS "filedYear"
    FROM unnest(
      ${districtCodes}::text[], ${docketCores}::text[]
    ) AS want(court_code, docket_core)
    JOIN court ON lower(court.provider_court_id) = want.court_code
    JOIN legal_case ON legal_case.court_id = court.id
      AND federal_docket_core(legal_case.docket_number) = want.docket_core
  `;

  const matches = new Map<string, CaseMatch[]>();
  for (const row of rows) {
    const key = `${row.courtCode}/${row.docketCore}`;
    const existing = matches.get(key);
    if (existing) existing.push(row);
    else matches.set(key, [row]);
  }
  return matches;
}

/**
 * Back-fill party appearances for federal district cases from the FJC
 * Integrated Database.
 *
 * Identity: one entity per (IDB row, role). Names are NOT merged across cases.
 * The IDB gives us a name string and nothing else — no party identifier, no
 * address, no counsel — so merging "SMITH" across two districts would assert a
 * shared identity the source does not support, and in a public legal directory
 * that assertion is the harmful direction to be wrong in. Cross-case identity
 * resolution belongs to a later, evidence-backed matcher; the CourtListener
 * REST path already supplies it for the dockets it covers, via that provider's
 * own party ids.
 */
export async function ingestFjcIdbParties(
  sql: Sql,
  options: FjcIdbPartyBackfillOptions,
): Promise<FjcIdbPartyBackfillResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.snapshotDate)) {
    throw new Error("Bulk snapshot date must be YYYY-MM-DD");
  }
  if (options.filingYear !== undefined
    && (!Number.isInteger(options.filingYear) || options.filingYear < 1900 || options.filingYear > 2100)) {
    throw new Error("Filing year must be 1900-2100");
  }
  const batchSize = Math.min(Math.max(options.batchSize ?? DEFAULT_BATCH_SIZE, 1), 5000);

  const [provider] = await sql<{ id: string }[]>`
    SELECT id FROM provider WHERE code = 'fjc_idb'
  `;
  if (!provider) throw new Error("FJC Integrated Database provider seed is missing");

  const result: FjcIdbPartyBackfillResult = {
    rowsRead: 0,
    unusableRows: 0,
    skippedOtherYear: 0,
    unmatchedCases: 0,
    matchedCases: 0,
    entitiesCreated: 0,
    appearancesWritten: 0,
    failed: 0,
    errors: [],
  };

  const objectKey = `courtlistener/bulk/${options.snapshotDate}/fjc-integrated-database.csv.bz2`;
  let batch: Array<{ row: FjcIdbRow; key: NonNullable<ReturnType<typeof fjcIdbCaseKey>> }> = [];

  const flush = async () => {
    if (batch.length === 0) return;
    const pending = batch;
    batch = [];

    const matches = await findCases(sql, pending.map((item) => item.key));

    for (const { row, key } of pending) {
      const candidates = matches.get(`${key.districtCode}/${key.docketCore}`) ?? [];
      // Office disambiguates two cases that share a core within one district.
      // Filing year is the guard against the IDB's century-ambiguous 2-digit
      // year matching a case from the wrong century.
      const legalCase = candidates.find((candidate) =>
        (key.office === null || candidate.docketOffice === null || candidate.docketOffice === key.office)
        && (candidate.filedYear === null || candidate.filedYear === key.filingYear));
      if (!legalCase) {
        result.unmatchedCases += 1;
        continue;
      }
      result.matchedCases += 1;

      const parties = fjcIdbParties(row);
      if (parties.length === 0) continue;

      try {
        await sql.begin(async (tx) => {
          const [artifact] = await tx<{ id: string }[]>`
            INSERT INTO raw_artifact (
              provider_id, source_uri, source_record_id, content_hash, object_key,
              media_type, retrieved_at, response_metadata
            ) VALUES (
              ${provider.id}, ${fjcIdbSourceUri(options.snapshotDate, row.id)}, ${row.id},
              ${fjcIdbContentHash(row)}, ${objectKey}, 'text/csv', ${options.snapshotDate},
              ${tx.json({
                source: "fjc_integrated_database",
                snapshotDate: options.snapshotDate,
                districtCode: key.districtCode,
                docketCore: key.docketCore,
              })}
            )
            ON CONFLICT (provider_id, source_uri, content_hash)
            DO UPDATE SET retrieved_at = EXCLUDED.retrieved_at
            RETURNING id
          `;
          if (!artifact) throw new Error("FJC IDB raw artifact was not persisted");

          for (const party of parties) {
            const identifierValue = `${row.id}:${party.role}`;
            const [existing] = await tx<{ entity_id: string }[]>`
              SELECT entity_id FROM entity_identifier
              WHERE provider_id = ${provider.id}
                AND identifier_type = 'fjc_idb_party'
                AND identifier_value = ${identifierValue}
            `;

            let entityId = existing?.entity_id;
            if (!entityId) {
              const [entity] = await tx<{ id: string }[]>`
                INSERT INTO entity (
                  public_id, entity_type, display_name, normalized_name,
                  verification, source_artifact_id
                ) VALUES (
                  ${createPublicId("entity")}, 'unknown', ${party.nameAsFiled},
                  ${party.nameAsFiled.toLocaleLowerCase("en-US")}, 'not_verified', ${artifact.id}
                )
                RETURNING id
              `;
              if (!entity) throw new Error("FJC IDB party entity was not persisted");
              entityId = entity.id;
              result.entitiesCreated += 1;

              await tx`
                INSERT INTO entity_identifier (
                  entity_id, provider_id, identifier_type, identifier_value
                ) VALUES (
                  ${entityId}, ${provider.id}, 'fjc_idb_party', ${identifierValue}
                )
              `;
            }

            await tx`
              INSERT INTO party_appearance (
                case_id, entity_id, role, party_name_as_filed, source_artifact_id
              ) VALUES (
                ${legalCase.caseId}, ${entityId}, ${party.role},
                ${party.nameAsFiled}, ${artifact.id}
              )
              ON CONFLICT (case_id, entity_id, role, started_on)
              DO UPDATE SET
                party_name_as_filed = EXCLUDED.party_name_as_filed,
                source_artifact_id = EXCLUDED.source_artifact_id
            `;
            result.appearancesWritten += 1;
          }
        });
      } catch (error) {
        result.failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        if (result.errors.length < 25) result.errors.push({ rowId: row.id, error: message });
      }
    }
  };

  for await (const row of readFjcIdbRows(options.filePath)) {
    result.rowsRead += 1;
    const key = fjcIdbCaseKey(row);
    if (!key) {
      result.unusableRows += 1;
      continue;
    }
    if (options.filingYear !== undefined && key.filingYear !== options.filingYear) {
      result.skippedOtherYear += 1;
      continue;
    }
    batch.push({ row, key });
    if (batch.length >= batchSize) await flush();
    if (options.rowLimit && result.matchedCases >= options.rowLimit) break;
  }
  await flush();

  return result;
}

export async function recordFjcIdbCheckpoint(
  sql: Sql,
  input: {
    snapshotDate: string;
    filingYear: number;
    result: FjcIdbPartyBackfillResult;
    completed: boolean;
  },
): Promise<void> {
  await sql`
    INSERT INTO fjc_idb_import_checkpoint (
      snapshot_date, filing_year, rows_read, rows_matched, appearances_written,
      completed_at, updated_at
    ) VALUES (
      ${input.snapshotDate}, ${input.filingYear}, ${input.result.rowsRead},
      ${input.result.matchedCases}, ${input.result.appearancesWritten},
      ${input.completed ? new Date().toISOString() : null}, now()
    )
    ON CONFLICT (snapshot_date, filing_year) DO UPDATE SET
      rows_read = EXCLUDED.rows_read,
      rows_matched = EXCLUDED.rows_matched,
      appearances_written = EXCLUDED.appearances_written,
      completed_at = EXCLUDED.completed_at,
      updated_at = now()
  `;
}
