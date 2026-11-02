import type postgres from "postgres";
import { latestPublicationColumnSql } from "@/modules/publication/application/current-visibility";
import { searchExcludedCaseSql } from "@/modules/publication/domain/search-exclusion";
import { officialDocketPageUrl } from "@/modules/ingestion/providers/scotus/docket-status";
import { circuitOfCourtName } from "@/modules/scotus/domain/circuit-justice";
import { isEmergencyApplication, type JourneyBenchmarks, type JourneyInput } from "@/modules/scotus/domain/case-journey";

type Sql = ReturnType<typeof postgres>;

function missingRelation(error: unknown) {
  return (error as { code?: string }).code === "42P01" || (error as { code?: string }).code === "42703";
}

const displayableCase = (alias: string) => latestPublicationColumnSql("displayable", "legal_case", `${alias}.id`);

/** Official docket facts for one Supreme Court case, plus the matching appeals case when the docket names its number. */
export async function loadCaseJourney(sql: Sql, casePublicId: string, entries: JourneyInput["entries"]): Promise<JourneyInput | null> {
  try {
    return await sql.begin(async (tx) => {
      await tx`SET LOCAL statement_timeout = '2500ms'`;
      const [row] = await tx<Array<{ docketNumber: string; sourceUrl: string | null; lowerCourt: string | null; lowerDecided: string | null;
        lowerNumbers: unknown; docketedOn: string | null; certStatus: JourneyInput["certStatus"]; certStatusOn: string | null; certEntry: string | null;
        judgmentOn: string | null; judgmentEntry: string | null }>>`
        SELECT coalesce(status.docket_number, lc.docket_number) AS "docketNumber", status.source_url AS "sourceUrl",
          coalesce(status.lower_court, enrichment.lower_court_name) AS "lowerCourt",
          coalesce(status.lower_court_decided_on, enrichment.lower_court_decided_on)::text AS "lowerDecided",
          coalesce(enrichment.lower_court_case_numbers, '[]'::jsonb) AS "lowerNumbers",
          coalesce(status.docketed_on, enrichment.docketed_on)::text AS "docketedOn",
          status.cert_status AS "certStatus", status.cert_status_on::text AS "certStatusOn", status.cert_entry AS "certEntry",
          status.judgment_on::text AS "judgmentOn", status.judgment_entry AS "judgmentEntry"
        FROM legal_case lc
        LEFT JOIN scotus_docket_status status ON status.case_id = lc.id
        LEFT JOIN scotus_case_enrichment enrichment ON enrichment.case_id = lc.id
        WHERE lc.public_id = ${casePublicId} AND lc.publication = 'published'
          AND (status.case_id IS NOT NULL OR enrichment.case_id IS NOT NULL)
      `;
      if (!row?.docketNumber) return null;
      const lowerCaseNumbers = (Array.isArray(row.lowerNumbers) ? row.lowerNumbers : []).filter((value): value is string => typeof value === "string" && value.trim().length > 0).slice(0, 4);
      const circuit = circuitOfCourtName(row.lowerCourt);
      let linkedLowerCase: JourneyInput["linkedLowerCase"] = null;
      if (circuit && lowerCaseNumbers.length) {
        const matches = await tx<Array<{ publicId: string; caption: string; docketNumber: string | null }>>`
          SELECT lc.public_id AS "publicId", lc.caption, lc.docket_number AS "docketNumber"
          FROM court JOIN legal_case lc ON lc.court_id = court.id AND lc.docket_number IN ${tx(lowerCaseNumbers)}
          WHERE lower(court.provider_court_id) = ${circuit} AND lc.publication = 'published'
            AND ${tx.unsafe(displayableCase("lc"))} AND NOT ${tx.unsafe(searchExcludedCaseSql("lc"))}
          LIMIT 2
        `;
        // Link only an unambiguous match: one appeals case in that circuit with that number.
        if (matches.length === 1) linkedLowerCase = matches[0]!;
      }
      return {
        docketNumber: row.docketNumber, officialDocketUrl: row.sourceUrl ?? officialDocketPageUrl(row.docketNumber),
        lowerCourt: row.lowerCourt, lowerCourtDecidedOn: row.lowerDecided, lowerCaseNumbers, linkedLowerCase,
        docketedOn: row.docketedOn, certStatus: row.certStatus, certStatusOn: row.certStatusOn, certEntry: row.certEntry,
        judgmentOn: row.judgmentOn, judgmentEntry: row.judgmentEntry, entries,
      };
    });
  } catch (error) {
    if (missingRelation(error) || (error as { code?: string }).code === "57014") return null;
    throw error;
  }
}

export interface OnwardScotusCase { publicId: string; caption: string; docketNumber: string; certStatus: string | null; certStatusOn: string | null; judgmentOn: string | null }

/** For an appeals case: the Supreme Court case whose official docket names this case's number and circuit. */
export async function loadOnwardSupremeCourt(sql: Sql, providerCourtId: string | null, docketNumber: string | null): Promise<OnwardScotusCase[]> {
  const circuit = (providerCourtId ?? "").toLowerCase();
  if (!docketNumber || !/^ca(\d+|dc|fc|fed)$/.test(circuit)) return [];
  try {
    return await sql.begin(async (tx) => {
      await tx`SET LOCAL statement_timeout = '2000ms'`;
      const rows = await tx<Array<OnwardScotusCase & { lowerCourt: string | null }>>`
        SELECT lc.public_id AS "publicId", lc.caption, coalesce(status.docket_number, lc.docket_number) AS "docketNumber",
          coalesce(status.lower_court, enrichment.lower_court_name) AS "lowerCourt",
          status.cert_status AS "certStatus", status.cert_status_on::text AS "certStatusOn", status.judgment_on::text AS "judgmentOn"
        FROM scotus_case_enrichment enrichment
        JOIN legal_case lc ON lc.id = enrichment.case_id AND lc.publication = 'published'
        LEFT JOIN scotus_docket_status status ON status.case_id = lc.id
        WHERE enrichment.lower_court_case_numbers ? ${docketNumber}
          AND ${tx.unsafe(displayableCase("lc"))} AND NOT ${tx.unsafe(searchExcludedCaseSql("lc"))}
        LIMIT 5
      `;
      return rows.filter((row) => circuitOfCourtName(row.lowerCourt) === (circuit === "cafed" ? "cafc" : circuit))
        .map((row) => ({ publicId: row.publicId, caption: row.caption, docketNumber: row.docketNumber, certStatus: row.certStatus, certStatusOn: row.certStatusOn, judgmentOn: row.judgmentOn }));
    });
  } catch (error) {
    if (missingRelation(error) || (error as { code?: string }).code === "57014") return [];
    throw error;
  }
}

let benchmarkCache: { at: number; value: JourneyBenchmarks | null } | null = null;

/** Typical times across every Supreme Court docket Jurvio holds (petitions and "A" applications kept apart). Cached six hours. */
export async function loadJourneyBenchmarks(sql: Sql): Promise<JourneyBenchmarks | null> {
  if (benchmarkCache && Date.now() - benchmarkCache.at < 6 * 3_600_000) return benchmarkCache.value;
  try {
    const value = await sql.begin(async (tx) => {
      await tx`SET LOCAL statement_timeout = '4000ms'`;
      const [row] = await tx<Array<{ held: number; earliest: string | null; lowerDays: number | null; lowerN: number; deniedDays: number | null; deniedN: number;
        judgmentDays: number | null; judgmentN: number; apps: number; appDays: number | null; appN: number }>>`
        WITH d AS (
          SELECT docket_number ~* '^[0-9]{2}A[0-9]+$' AS app, docketed_on, lower_court_decided_on, cert_status, cert_status_on, judgment_on, last_entry_on
          FROM scotus_docket_status
        ), g AS (
          SELECT app,
            CASE WHEN docketed_on - lower_court_decided_on BETWEEN 0 AND 3650 THEN docketed_on - lower_court_decided_on END AS lower_days,
            CASE WHEN cert_status = 'denied' AND cert_status_on - docketed_on BETWEEN 0 AND 3650 THEN cert_status_on - docketed_on END AS denied_days,
            CASE WHEN judgment_on - docketed_on BETWEEN 0 AND 3650 THEN judgment_on - docketed_on END AS judgment_days,
            CASE WHEN last_entry_on - docketed_on BETWEEN 0 AND 3650 THEN last_entry_on - docketed_on END AS last_days,
            docketed_on
          FROM d
        )
        SELECT count(*)::int AS held, min(docketed_on)::text AS earliest,
          percentile_disc(0.5) WITHIN GROUP (ORDER BY lower_days) FILTER (WHERE NOT app) AS "lowerDays",
          count(lower_days) FILTER (WHERE NOT app)::int AS "lowerN",
          percentile_disc(0.5) WITHIN GROUP (ORDER BY denied_days) FILTER (WHERE NOT app) AS "deniedDays",
          count(denied_days) FILTER (WHERE NOT app)::int AS "deniedN",
          percentile_disc(0.5) WITHIN GROUP (ORDER BY judgment_days) FILTER (WHERE NOT app) AS "judgmentDays",
          count(judgment_days) FILTER (WHERE NOT app)::int AS "judgmentN",
          count(*) FILTER (WHERE app)::int AS apps,
          percentile_disc(0.5) WITHIN GROUP (ORDER BY last_days) FILTER (WHERE app) AS "appDays",
          count(last_days) FILTER (WHERE app)::int AS "appN"
        FROM g
      `;
      if (!row || !row.held) return null;
      return {
        petitions: {
          lowerToFiling: { days: row.lowerDays, cases: row.lowerN },
          filingToCertDenied: { days: row.deniedDays, cases: row.deniedN },
          filingToJudgment: { days: row.judgmentDays, cases: row.judgmentN },
        },
        applications: { held: row.apps, filingToLatestEntry: { days: row.appDays, cases: row.appN } },
        docketsHeld: row.held, earliestDocketed: row.earliest,
      } satisfies JourneyBenchmarks;
    });
    benchmarkCache = { at: Date.now(), value };
    return value;
  } catch (error) {
    if (missingRelation(error) || (error as { code?: string }).code === "57014") return null;
    throw error;
  }
}

export { isEmergencyApplication };
