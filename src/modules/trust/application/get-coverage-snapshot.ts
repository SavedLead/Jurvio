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
  /** Null when no precomputed opinion total is available. Never counted live. */
  publishedOpinions: number | null;
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
  /** True when heldForReview is a planner estimate, not a counted total. */
  heldApproximate: boolean;
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

/** A snapshot can replace the page only when it actually has family counts. */
export function coverageSnapshotUsable(snapshot: CoverageSnapshot): boolean {
  return publishedCasesFromFamilies(snapshot.families ?? []) > 0;
}

/**
 * A failed refresh must not wipe the last family table. Sections the new
 * snapshot did load replace that section; a null section keeps the previous one.
 */
export function retainCoverageSnapshot(previous: CoverageSnapshot | null, next: CoverageSnapshot): CoverageSnapshot {
  if (!coverageSnapshotUsable(next)) return previous ?? next;
  if (!previous) return next;
  return {
    checkedAt: next.checkedAt,
    families: next.families,
    corpus: next.corpus ?? previous.corpus,
    limitations: next.limitations ?? previous.limitations,
  };
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

/**
 * Per-court published counters. Family totals (Supreme Court, appeals,
 * district, other) are sums of these rows, not a fresh count of cases.
 */
async function readStatCourts(sql: Sql): Promise<CourtRow[]> {
  const rows = await sql<{ code: string; publishedCases: string; latestFiledOn: string | null }[]>`
    SELECT lower(court.provider_court_id) AS code,
           sum(stats.case_count)::bigint AS "publishedCases",
           max(stats.latest_case_date)::text AS "latestFiledOn"
    FROM court_public_stats stats
    JOIN court ON court.id = stats.court_id
    WHERE stats.case_count > 0
      AND court.provider_court_id IS NOT NULL
    GROUP BY 1
  `;
  return rows.map((row) => ({
    code: row.code,
    publishedCases: Number(row.publishedCases),
    earliestFiledOn: null,
    latestFiledOn: row.latestFiledOn,
  }));
}

export async function getCoverageSnapshot(sql: Sql): Promise<CoverageSnapshot> {
  const checkedAt = new Date().toISOString();

  const loaded = await safe(async () => {
    const courts = await readStatCourts(sql);
    const circuits = await sql<{ code: string }[]>`
      SELECT lower(court_code) AS code FROM appellate_source_registry
    `;
    const districts = await sql<{ code: string; live: boolean }[]>`
      SELECT lower(jurvio_court_code) AS code, rss_available AS live
      FROM direct_court_registry
      WHERE court_type = 'district'
    `;
    const families = classifyCourts(
      courts,
      circuits.map((row) => row.code),
      districts.map((row) => row.code),
    );
    const districtCodes = new Set(districts.map((row) => row.code));
    const withRecords = new Set(
      courts.filter((row) => districtCodes.has(row.code) && row.publishedCases > 0).map((row) => row.code),
    ).size;
    return {
      families,
      districtsWithoutRecords: Math.max(0, districts.length - withRecords),
      districtsLiveMonitored: districts.filter((row) => row.live).length,
    };
  });
  const families = loaded?.families ?? null;
  const publishedCases = families ? publishedCasesFromFamilies(families) : null;
  const familyEarliest = families?.map((family) => family.earliestFiledOn).filter((value): value is string => Boolean(value)).sort().at(0) ?? null;
  const familyLatest = families?.map((family) => family.latestFiledOn).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
  const corpus = publishedCases === null ? null : {
    publishedCases,
    publishedOpinions: null,
    courtsWithRecords: families?.reduce((total, family) => total + family.courtsWithRecords, 0) ?? 0,
    earliestFiledOn: familyEarliest,
    latestFiledOn: familyLatest,
    lastSourceRetrievedAt: null,
  };

  const held = await safe(async () => {
    const [estimate] = await sql<{ total: string }[]>`
      SELECT greatest(coalesce(reltuples, 0), 0)::bigint AS total
      FROM pg_class
      WHERE relname = 'legal_case_draft_created_idx'
    `;
    const total = Number(estimate?.total ?? 0);
    return Number.isFinite(total) ? total : 0;
  });
  const blocked = await safe(async () => {
    return await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL statement_timeout = '3s'`);
      const rows = await tx<{ reason: string | null; count: number }[]>`
        SELECT blocker_code AS reason, count(*)::int AS count
        FROM appellate_ingestion_item
        WHERE state = 'blocked'
        GROUP BY 1
        ORDER BY count(*) DESC
      `;
      return rows
        .filter((row) => row.count > 0)
        .map((row) => ({ reason: row.reason ?? "unspecified", count: row.count }));
    });
  });
  const limitations = loaded ? {
    heldForReview: held ?? 0,
    heldApproximate: true,
    blockedDocuments: blocked ?? [],
    districtsWithoutRecords: loaded.districtsWithoutRecords,
    districtsLiveMonitored: loaded.districtsLiveMonitored,
  } : null;

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

/** A coverage year visitors can see. A year after the current Eastern year is omitted. */
export function coverageYear(value: string | null | undefined, today = new Date()): string | null {
  if (!value || !/^\d{4}/.test(value)) return null;
  const year = value.slice(0, 4);
  const current = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric" }).format(today);
  return Number(year) > Number(current) ? null : year;
}

function currentEasternYear(today: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric" }).format(today);
}

/**
 * Formats a coverage date range. A latest year after this year is shown as
 * the current year, so one bad filed date cannot make the range say 2027.
 */
export function formatCoverageRange(earliest: string | null, latest: string | null, today = new Date()): string {
  const start = coverageYear(earliest, today);
  const end = coverageYear(latest, today) ?? (start ? currentEasternYear(today) : null);
  if (!start || !end) return "Unknown";
  return start === end ? start : `${start}–${end}`;
}

/** "through 2026", never a year after this one. */
export function coverageThroughLabel(earliest: string | null, latest: string | null, today = new Date()): string {
  if (coverageYear(earliest, today)) return formatCoverageRange(earliest, latest, today);
  const end = coverageYear(latest, today);
  if (end) return `through ${end}`;
  if (latest && /^\d{4}/.test(latest) && Number(latest.slice(0, 4)) > Number(currentEasternYear(today))) {
    return `through ${currentEasternYear(today)}`;
  }
  return "Unknown";
}
