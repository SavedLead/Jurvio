import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

/**
 * Live coverage facts for the public /coverage page.
 *
 * The page used to describe coverage in the future tense ("Jurvio will publish
 * verified counts... directly from the production database") while the corpus
 * was already at ~450,000 cases with 82 of 94 district courts holding no
 * records at all. A trust page that cannot be checked against the database is
 * not a trust page, and inviting crawlers to a corpus whose gaps are undisclosed
 * is exactly what docs/26 forbids ("Coverage labels disclose court, date range,
 * source availability and last retrieval").
 *
 * Every section is isolated: a failing query degrades that section to null and
 * the page renders an honest "temporarily unavailable" instead of a 500 or, far
 * worse, a confident wrong number. Counts reflect PUBLISHED records only — the
 * same publication gate the public routes use.
 */

export interface CorpusCoverage {
  publishedCases: number;
  publishedOpinions: number;
  courtsWithRecords: number;
  earliestFiledOn: string | null;
  latestFiledOn: string | null;
  lastSourceRetrievedAt: string | null;
}

export interface CourtFamilyCoverage {
  /** Stable key for React and tests. */
  key: "supreme" | "appellate" | "district" | "other";
  name: string;
  /** Courts in this family that have at least one published case. */
  courtsWithRecords: number;
  /** Courts Jurvio tracks in this family, when the family has a fixed roster. */
  courtsTracked: number | null;
  publishedCases: number;
  earliestFiledOn: string | null;
  latestFiledOn: string | null;
}

export interface CoverageLimitations {
  /** Records ingested but withheld from publication pending human review. */
  heldForReview: number;
  /** Documents whose text could not be extracted, by reason. */
  blockedDocuments: Array<{ reason: string; count: number }>;
  /** District courts tracked but not yet contributing any published record. */
  districtsWithoutRecords: number;
  /** District courts on a live source feed. */
  districtsLiveMonitored: number;
}

export interface CoverageSnapshot {
  checkedAt: string;
  corpus: CorpusCoverage | null;
  families: CourtFamilyCoverage[] | null;
  limitations: CoverageLimitations | null;
}

interface CourtRow {
  code: string;
  publishedCases: number;
  earliestFiledOn: string | null;
  latestFiledOn: string | null;
}

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    // Coverage is a trust surface, not a critical path: an unavailable section
    // must never take down the page or invent a number to fill the space.
    return null;
  }
}

/** The single published-case total is the sum of the family rows, not a second scan. */
export function publishedCasesFromFamilies(families: readonly { publishedCases: number }[]): number {
  return families.reduce((total, family) => total + family.publishedCases, 0);
}

/** Sums per-court rows into one family total. Pure, so the roll-up is testable. */
export function summarizeFamily(
  key: CourtFamilyCoverage["key"],
  name: string,
  rows: readonly CourtRow[],
  courtsTracked: number | null,
): CourtFamilyCoverage {
  const dates = (pick: (row: CourtRow) => string | null) =>
    rows.map(pick).filter((value): value is string => Boolean(value)).sort();
  const earliest = dates((row) => row.earliestFiledOn);
  const latest = dates((row) => row.latestFiledOn);
  return {
    key,
    name,
    courtsWithRecords: rows.filter((row) => row.publishedCases > 0).length,
    courtsTracked,
    publishedCases: rows.reduce((total, row) => total + row.publishedCases, 0),
    earliestFiledOn: earliest.at(0) ?? null,
    latestFiledOn: latest.at(-1) ?? null,
  };
}

/**
 * Splits per-court counts into the federal families Jurvio tracks, using the
 * ingestion registries as the roster of what is *supposed* to be covered. That
 * denominator is the honest part: "12 of 94 district courts" says something
 * "12 district courts" does not.
 */
export function classifyCourts(
  courts: readonly CourtRow[],
  circuitCodes: readonly string[],
  districtCodes: readonly string[],
): CourtFamilyCoverage[] {
  const circuits = new Set(circuitCodes);
  const districts = new Set(districtCodes);
  const byCode = new Map(courts.map((row) => [row.code, row]));

  const rosterRows = (codes: Set<string>): CourtRow[] =>
    [...codes].map(
      (code) => byCode.get(code) ?? { code, publishedCases: 0, earliestFiledOn: null, latestFiledOn: null },
    );

  const supreme = courts.filter((row) => row.code === "scotus");
  const other = courts.filter(
    (row) => row.code !== "scotus" && !circuits.has(row.code) && !districts.has(row.code),
  );

  const families = [
    summarizeFamily("supreme", "Supreme Court of the United States", supreme, 1),
    summarizeFamily(
      "appellate",
      "United States Courts of Appeals",
      rosterRows(circuits),
      circuits.size || null,
    ),
    summarizeFamily(
      "district",
      "United States District Courts",
      rosterRows(districts),
      districts.size || null,
    ),
    summarizeFamily("other", "Other federal courts", other, null),
  ];
  // A family with no roster and no records is noise, not a disclosure.
  return families.filter((family) => family.courtsTracked !== null || family.publishedCases > 0);
}

export async function getCoverageSnapshot(sql: Sql): Promise<CoverageSnapshot> {
  const checkedAt = new Date().toISOString();

  const families = await safe(async () => {
    const courts = await sql<CourtRow[]>`
      SELECT lower(court.provider_court_id) AS code,
             count(*)::int AS "publishedCases",
             min(legal_case.filed_on)::text AS "earliestFiledOn",
             max(legal_case.filed_on)::text AS "latestFiledOn"
      FROM court
      JOIN legal_case ON legal_case.court_id = court.id
      WHERE legal_case.publication='published' AND court.provider_court_id IS NOT NULL
      GROUP BY 1
    `;
    const circuits = await sql<{ code: string }[]>`
      SELECT lower(court_code) AS code FROM appellate_source_registry
    `;
    const districts = await sql<{ code: string }[]>`
      SELECT lower(jurvio_court_code) AS code FROM direct_court_registry WHERE court_type='district'
    `;
    return classifyCourts(
      courts,
      circuits.map((row) => row.code),
      districts.map((row) => row.code),
    );
  });

  const publishedCases = families ? publishedCasesFromFamilies(families) : null;
  const familyEarliest = families?.map((family) => family.earliestFiledOn).filter((value): value is string => Boolean(value)).sort().at(0) ?? null;
  const familyLatest = families?.map((family) => family.latestFiledOn).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
  const corpusDetails = await safe(async () => {
    return await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL statement_timeout = '4s'`);
      const [row] = await tx<
        { publishedOpinions: number; lastSourceRetrievedAt: string | null }[]
      >`
        SELECT
          (SELECT count(*)::int FROM document
             JOIN judicial_opinion ON judicial_opinion.document_id = document.id
             JOIN legal_case ON legal_case.id = document.case_id
            WHERE document.publication='published' AND legal_case.publication='published'
          ) AS "publishedOpinions",
          (SELECT max(retrieved_at)::text FROM raw_artifact) AS "lastSourceRetrievedAt"
      `;
      return row ?? null;
    });
  });
  const corpus = publishedCases === null ? null : {
    publishedCases,
    publishedOpinions: corpusDetails?.publishedOpinions ?? 0,
    courtsWithRecords: families?.reduce((total, family) => total + family.courtsWithRecords, 0) ?? 0,
    earliestFiledOn: familyEarliest,
    latestFiledOn: familyLatest,
    lastSourceRetrievedAt: corpusDetails?.lastSourceRetrievedAt ?? null,
  };

  const limitations = await safe(async () => {
    const [held] = await sql<{ count: number }[]>`
      SELECT count(*)::int FROM legal_case WHERE publication='draft' AND verification='needs_review'
    `;
    const blocked = await sql<{ reason: string | null; count: number }[]>`
      SELECT blocker_code AS reason, count(*)::int
      FROM appellate_ingestion_item WHERE state='blocked'
      GROUP BY 1 ORDER BY count(*) DESC
    `;
    const [districts] = await sql<{ tracked: number; live: number; withRecords: number }[]>`
      SELECT
        (SELECT count(*)::int FROM direct_court_registry WHERE court_type='district') AS tracked,
        (SELECT count(*)::int FROM direct_court_registry WHERE court_type='district' AND rss_available) AS live,
        (SELECT count(*)::int FROM direct_court_registry registry
          WHERE registry.court_type='district'
            AND EXISTS (
              SELECT 1 FROM court
              JOIN legal_case ON legal_case.court_id = court.id
              WHERE lower(court.provider_court_id) = lower(registry.jurvio_court_code)
                AND legal_case.publication='published'
            )) AS "withRecords"
    `;
    return {
      heldForReview: held?.count ?? 0,
      blockedDocuments: blocked
        .filter((row) => row.count > 0)
        .map((row) => ({ reason: row.reason ?? "unspecified", count: row.count })),
      districtsWithoutRecords: Math.max(0, (districts?.tracked ?? 0) - (districts?.withRecords ?? 0)),
      districtsLiveMonitored: districts?.live ?? 0,
    };
  });

  return { checkedAt, corpus, families, limitations };
}

/** Human-readable reason for a text-extraction blocker. Falls back to the raw code. */
export function describeBlocker(reason: string): string {
  const known: Record<string, string> = {
    ocr_failed: "Scanned source document could not be read reliably enough to publish",
    ocr_required: "Scanned source document is awaiting text extraction",
    missing_docket_number: "Source document does not identify its docket number",
    transient_processing_failure: "Text extraction did not finish and will be retried automatically",
  };
  return known[reason] ?? reason.replaceAll("_", " ");
}

/** Formats a coverage date range, preserving "unknown" rather than guessing. */
export function formatCoverageRange(earliest: string | null, latest: string | null): string {
  if (!earliest || !latest) return "Unknown";
  const year = (value: string) => value.slice(0, 4);
  return year(earliest) === year(latest) ? year(earliest) : `${year(earliest)}–${year(latest)}`;
}
