/**
 * GovInfo USCOURTS daily source: every district and circuit opinion the courts
 * send to GovInfo, read from /collections/USCOURTS/{since}. Each package (one
 * case, newest opinion date) is cross-checked against what other sources
 * already stored for that case:
 *   - another source has an opinion/order entry or document within a day -> 'matched', nothing written;
 *   - otherwise a "published on GovInfo" docket entry (provider_entry_id govinfo:{package}:{date});
 *   - no case yet -> a draft, not_verified case (same rules as the other live feeds).
 * Sealed/restricted captions are never stored. Nothing here publishes.
 *
 * Free: GOVINFO_API_KEY (api.data.gov) when set, else DEMO_KEY with one page per
 * run (DEMO_KEY allows about 10 requests an hour per IP).
 */
import type postgres from "postgres";
import { isRestrictedDocketText } from "../domain/federal-stream";
import type { ArtifactStore } from "../application/artifact-store";
import {
  baseDocketKey, collectionUrl, nextOffsetMark, parseGovInfoPackage,
  type GovInfoCollectionPage, type ParsedGovInfoPackage,
} from "../providers/govinfo/uscourts";
import { insertDocketEntryOnce, matchOrCreateDraftCase, providerId, resolveCourt, storeFeedArtifact } from "./persist";
import { normalizeDocket } from "./coa-feeds";
import { CourtFetchHttpError, errorText, httpStatusOf, recordCourtFetch } from "@/modules/operations/application/court-fetch-log";
import { recordSourceWatermark } from "@/modules/operations/application/court-freshness";
import { CIRCUIT_CODES } from "@/modules/operations/domain/court-sources";

type Sql = ReturnType<typeof postgres>;
type Tx = postgres.TransactionSql;

export interface GovInfoDailyOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  /** Pages per run; DEMO_KEY is always 1. */
  maxPages?: number;
  pageSize?: number;
  now?: Date;
  sleep?: (ms: number) => Promise<void>;
}

export interface GovInfoDailyResult {
  ok: boolean;
  credential: "configured" | "demo";
  requests: number;
  packages: number;
  tracked: number;
  outcomes: Record<"matched" | "entry" | "new_case" | "restricted" | "ambiguous" | "seen_before", number>;
  perCourt: Record<string, { packages: number; newItems: number }>;
  sweepComplete: boolean;
  error?: string;
}

const COURT_NAMES: Readonly<Record<string, string>> = {
  ca1: "First Circuit", ca2: "Second Circuit", ca3: "Third Circuit", ca4: "Fourth Circuit", ca5: "Fifth Circuit",
  ca6: "Sixth Circuit", ca7: "Seventh Circuit", ca8: "Eighth Circuit", ca9: "Ninth Circuit", ca10: "Tenth Circuit",
  ca11: "Eleventh Circuit", cadc: "District of Columbia Circuit", cafc: "Federal Circuit",
};

export async function runGovInfoDaily(sql: Sql, store: ArtifactStore, options: GovInfoDailyOptions = {}): Promise<GovInfoDailyResult> {
  const apiKey = options.apiKey?.trim() || "DEMO_KEY";
  const demo = apiKey === "DEMO_KEY";
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const maxPages = demo ? 1 : Math.max(1, Math.min(options.maxPages ?? 10, 20));
  const pageSize = options.pageSize ?? 1000;
  const now = options.now ?? new Date();
  const result: GovInfoDailyResult = {
    ok: false, credential: demo ? "demo" : "configured", requests: 0, packages: 0, tracked: 0,
    outcomes: { matched: 0, entry: 0, new_case: 0, restricted: 0, ambiguous: 0, seen_before: 0 }, perCourt: {}, sweepComplete: false,
  };

  const districts = await sql<{ court_code: string; jurvio_court_code: string | null; court_name: string }[]>`
    SELECT court_code, jurvio_court_code, court_name FROM direct_court_registry WHERE court_type = 'district'
  `;
  const districtByCode = new Map(districts.map((row) => [row.court_code.toLowerCase(), row]));
  const districtCodes: ReadonlySet<string> = new Set(districtByCode.keys());
  const tracked = [...CIRCUIT_CODES, ...districtCodes];
  for (const court of tracked) result.perCourt[court] = { packages: 0, newItems: 0 };

  const [state] = await sql<{ since: Date; offset_mark: string | null; sweep_max_modified: Date | null }[]>`
    INSERT INTO govinfo_daily_state (id, since) VALUES (1, ${new Date(now.getTime() - 2 * 86_400_000)})
    ON CONFLICT (id) DO UPDATE SET updated_at = govinfo_daily_state.updated_at
    RETURNING since, offset_mark, sweep_max_modified
  `;
  if (!state) throw new Error("govinfo_daily_state was not initialised");
  const since = state.since.toISOString();
  let offsetMark = state.offset_mark;
  let sweepMax = state.sweep_max_modified?.toISOString() ?? null;
  const provider = await providerId(sql, "official_cmecf");
  const startedAtMs = Date.now();
  let lastUrl = collectionUrl(since, offsetMark, pageSize);
  const errors: string[] = [];

  for (let page = 0; page < maxPages; page += 1) {
    const url = collectionUrl(since, offsetMark, pageSize);
    lastUrl = url;
    const pageStarted = Date.now();
    let body: string;
    try {
      if (page > 0) await sleep(demo ? 4_000 : 1_000);
      result.requests += 1;
      const response = await fetchImpl(`${url}&api_key=${encodeURIComponent(apiKey)}`, {
        headers: { "user-agent": process.env.INGESTION_USER_AGENT ?? "Jurvio legal research ingestion contact@jurvio.com", accept: "application/json" },
        signal: AbortSignal.timeout(90_000),
      });
      if (!response.ok) throw new CourtFetchHttpError(url, response.status, "GovInfo USCOURTS collection");
      body = await response.text();
    } catch (error) {
      errors.push(errorText(error) ?? String(error));
      await recordCourtFetch(sql, { source: "govinfo", courtCode: "_all", url, startedAtMs: pageStarted,
        httpStatus: httpStatusOf(error), ok: false, error: errorText(error) });
      break;
    }
    const data = JSON.parse(body) as GovInfoCollectionPage;
    const packages = data.packages ?? [];
    result.packages += packages.length;
    const artifactId = await storeFeedArtifact(sql, store, {
      providerId: provider, sourceUri: url, sourceRecordId: "govinfo:uscourts", keyPrefix: "govinfo/uscourts",
      body, mediaType: "application/json", metadata: { since, packages: packages.length },
    });
    let pageNew = 0;
    for (const pkg of packages) {
      if (pkg.lastModified && (!sweepMax || pkg.lastModified > sweepMax)) sweepMax = pkg.lastModified;
      const parsed = parseGovInfoPackage(pkg, districtCodes);
      if (!parsed) continue;
      result.tracked += 1;
      const court = result.perCourt[parsed.courtCode] ?? (result.perCourt[parsed.courtCode] = { packages: 0, newItems: 0 });
      court.packages += 1;
      const outcome = await crossCheckPackage(sql, provider, artifactId, parsed, districtByCode.get(parsed.courtCode));
      result.outcomes[outcome] += 1;
      if (outcome === "entry" || outcome === "new_case") { court.newItems += 1; pageNew += 1; }
    }
    await recordCourtFetch(sql, { source: "govinfo", courtCode: "_all", url, startedAtMs: pageStarted, httpStatus: 200, ok: true,
      bytes: Buffer.byteLength(body), items: packages.length, newItems: pageNew });
    const next = nextOffsetMark(data);
    if (!next || packages.length === 0) {
      result.sweepComplete = true;
      offsetMark = null;
      break;
    }
    offsetMark = next;
  }

  result.ok = errors.length === 0;
  if (errors.length) result.error = errors.join("; ");
  if (result.requests > 0 && result.ok) {
    // Sweep finished: next sweep starts an hour before the newest change seen.
    const nextSince = result.sweepComplete
      ? new Date(Math.max(new Date(sweepMax ?? since).getTime() - 3_600_000, new Date(since).getTime()))
      : new Date(since);
    await sql`
      UPDATE govinfo_daily_state SET since = ${nextSince}, offset_mark = ${offsetMark},
        sweep_max_modified = ${result.sweepComplete ? null : sweepMax},
        sweeps_completed = sweeps_completed + ${result.sweepComplete ? 1 : 0}, updated_at = now()
      WHERE id = 1
    `;
  }

  // One row per tracked court per run, so the matrix shows when GovInfo was last
  // checked for every court (items 0 on days a court sent nothing).
  if (result.ok) {
    for (const [courtCode, counts] of Object.entries(result.perCourt)) {
      await recordCourtFetch(sql, { source: "govinfo", courtCode, url: lastUrl, startedAtMs, httpStatus: 200, ok: true,
        items: counts.packages, newItems: counts.newItems });
      await recordSourceWatermark(sql, { source: "govinfo", courtCode, ok: true, itemsFetched: counts.packages,
        newCases: 0, newEntries: counts.newItems, error: null });
    }
  }
  return result;
}

type Outcome = "matched" | "entry" | "new_case" | "restricted" | "ambiguous" | "seen_before";

async function crossCheckPackage(
  sql: Sql, provider: string, artifactId: string, pkg: ParsedGovInfoPackage,
  district: { court_code: string; jurvio_court_code: string | null; court_name: string } | undefined,
): Promise<Outcome> {
  const [seen] = await sql<{ outcome: string }[]>`
    SELECT outcome FROM govinfo_crosscheck WHERE package_id = ${pkg.packageId} AND date_issued = ${pkg.dateIssued}
  `;
  if (seen) return "seen_before";
  return sql.begin(async (tx) => {
    let outcome: Exclude<Outcome, "seen_before">;
    let caseId: string | null = null;
    if (isRestrictedDocketText(pkg.caption)) {
      outcome = "restricted";
    } else {
      const jurvioCode = pkg.courtType === "district" ? (district?.jurvio_court_code ?? pkg.courtCode) : pkg.courtCode;
      const existing = await findCase(tx, pkg, jurvioCode);
      if (existing === "ambiguous") {
        outcome = "ambiguous";
      } else {
        let created = false;
        if (existing) {
          caseId = existing;
        } else {
          const courtId = await resolveCourt(tx, {
            providerId: provider, courtCode: jurvioCode, artifactId,
            name: pkg.courtType === "district" ? (district?.court_name ?? jurvioCode.toUpperCase())
              : `United States Court of Appeals for the ${COURT_NAMES[pkg.courtCode] ?? pkg.courtCode}`,
            shortName: jurvioCode.toUpperCase(), jurisdiction: pkg.courtType === "district" ? "Federal District" : "Federal Appellate",
          });
          const match = await matchOrCreateDraftCase(tx, {
            providerId: provider, courtId, courtCode: jurvioCode, docketNumber: pkg.docketNumber, caption: pkg.caption,
            filedOn: null, decidedOn: pkg.dateIssued, artifactId, identifierType: "govinfo_package", identifierValue: pkg.packageId,
          });
          if (match.kind === "restricted") { outcome = "restricted"; await mark(tx, pkg, outcome, null); return outcome; }
          if (match.kind === "ambiguous") { outcome = "ambiguous"; await mark(tx, pkg, outcome, null); return outcome; }
          caseId = match.caseId;
          created = match.kind === "created";
        }
        if (!created && await otherSourceHasIt(tx, caseId, pkg.dateIssued)) {
          outcome = "matched";
        } else {
          await insertDocketEntryOnce(tx, {
            caseId, providerId: provider, providerEntryId: `govinfo:${pkg.packageId}:${pkg.dateIssued}`, entryNumber: null,
            filedOn: pkg.dateIssued, description: `Opinion or order published on GovInfo: ${pkg.detailsUrl}`,
            entryType: "opinion", importance: "high", artifactId,
          });
          outcome = created ? "new_case" : "entry";
        }
      }
    }
    await mark(tx, pkg, outcome, caseId);
    return outcome;
  });
}

async function mark(tx: Tx, pkg: ParsedGovInfoPackage, outcome: string, caseId: string | null) {
  await tx`
    INSERT INTO govinfo_crosscheck (package_id, date_issued, court_code, docket_number, outcome, case_id)
    VALUES (${pkg.packageId}, ${pkg.dateIssued}, ${pkg.courtCode}, ${pkg.docketNumber}, ${outcome}, ${caseId})
    ON CONFLICT (package_id, date_issued) DO NOTHING
  `;
}

/**
 * The case for this package. Districts: same office, year, case type and number
 * (judge suffixes ignored) via the federal_docket_core index. Circuits: the
 * normalized docket number. Two candidates -> 'ambiguous'.
 */
async function findCase(tx: Tx, pkg: ParsedGovInfoPackage, jurvioCode: string): Promise<string | null | "ambiguous"> {
  const rows = pkg.courtType === "district"
    ? await tx<{ id: string }[]>`
        SELECT legal_case.id FROM legal_case JOIN court ON court.id = legal_case.court_id
        WHERE lower(coalesce(court.provider_court_id, '')) = ${jurvioCode.toLowerCase()}
          AND federal_docket_core(legal_case.docket_number) = federal_docket_core(${pkg.docketNumber})
          AND legal_case.supreme_court_term IS NULL
        LIMIT 20`
    : await tx<{ id: string; docket_number: string }[]>`
        SELECT legal_case.id FROM legal_case JOIN court ON court.id = legal_case.court_id
        WHERE lower(coalesce(court.provider_court_id, '')) = ${jurvioCode.toLowerCase()}
          AND lower(regexp_replace(legal_case.docket_number, '[^a-zA-Z0-9]', '', 'g')) = ${normalizeDocket(pkg.docketNumber)}
        LIMIT 2`;
  let candidates = rows.map((row) => row.id);
  if (pkg.courtType === "district" && rows.length > 0) {
    const full = await tx<{ id: string; docket_number: string }[]>`
      SELECT id, docket_number FROM legal_case WHERE id = ANY(${candidates}::uuid[])`;
    const key = baseDocketKey(pkg.docketNumber);
    candidates = full.filter((row) => baseDocketKey(row.docket_number) === key).map((row) => row.id);
  }
  if (candidates.length > 1) return "ambiguous";
  return candidates[0] ?? null;
}

/** Another source already recorded an opinion/order on this case within a day of dateIssued. */
async function otherSourceHasIt(tx: Tx, caseId: string, dateIssued: string): Promise<boolean> {
  const [row] = await tx<{ hit: boolean }[]>`
    SELECT (
      EXISTS (
        SELECT 1 FROM docket_entry
        WHERE case_id = ${caseId} AND provider_entry_id NOT LIKE 'govinfo:%'
          AND filed_on BETWEEN ${dateIssued}::date - 1 AND ${dateIssued}::date + 1
          AND (entry_type IN ('opinion', 'order') OR description ~* '(opinion|order|memorandum|judgment|decision)')
      ) OR EXISTS (
        SELECT 1 FROM document
        WHERE case_id = ${caseId} AND filed_on BETWEEN ${dateIssued}::date - 1 AND ${dateIssued}::date + 1
      )
    ) AS hit
  `;
  return Boolean(row?.hit);
}
