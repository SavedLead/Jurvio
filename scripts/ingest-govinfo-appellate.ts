import { closeDb, db } from "@/db/client";
import { APPELLATE_COURT_REGISTRY, appellateCourtByCode } from "@/modules/ingestion/providers/appellate/registry";

type GovInfoSearchResult = {
  packageId?: string;
  granuleId?: string;
  title?: string;
  dateIssued?: string;
  lastModified?: string;
  download?: { pdfLink?: string };
  pdfLink?: string;
  summaryLink?: string;
};

type GovInfoSearchResponse = {
  results?: GovInfoSearchResult[];
  offsetMark?: string;
  nextOffsetMark?: string;
  count?: number;
};

const argument = (name: string) =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const courtArgument = argument("court") ?? "all";
const requestedCourts = courtArgument === "all"
  ? APPELLATE_COURT_REGISTRY.map((court) => court.code)
  : [...new Set(courtArgument.split(",").map((court) => court.trim().toLowerCase()).filter(Boolean))];
const pageSize = Number(argument("page-size") ?? "100");
const requestedPagesPerCourt = Number(argument("pages-per-court") ?? "1");
if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
  throw new Error("--page-size must be an integer from 1 to 1000");
}
if (!Number.isInteger(requestedPagesPerCourt) || requestedPagesPerCourt < 1 || requestedPagesPerCourt > 10) {
  throw new Error("--pages-per-court must be an integer from 1 to 10");
}

const apiKey = process.env.GOVINFO_API_KEY?.trim() || "DEMO_KEY";
// The shared key is strictly rate limited. A configured free key safely unlocks
// multi-page cycles without requiring another deployment.
const pagesPerCourt = apiKey === "DEMO_KEY" ? 1 : requestedPagesPerCourt;
const userAgent = process.env.INGESTION_USER_AGENT
  ?? "Jurvio legal research ingestion contact@jurvio.com";
const sql = db();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const GOVINFO_COURT_CODE_BY_JURVIO_CODE: Readonly<Record<string, string>> = Object.freeze({
  ca1: "ca1",
  ca2: "ca2",
  ca3: "ca3",
  ca4: "ca4",
  ca5: "ca5",
  ca6: "ca6",
  ca7: "ca7",
  ca8: "ca8",
  ca9: "ca9",
  ca10: "ca10",
  ca11: "ca11",
  cadc: "caDC",
  cafc: "ca13",
});

function govInfoCourtCode(jurvioCourtCode: string): string {
  const govInfoCode = GOVINFO_COURT_CODE_BY_JURVIO_CODE[jurvioCourtCode];
  if (!govInfoCode) throw new Error(`No GovInfo court-code mapping for ${jurvioCourtCode}`);
  return govInfoCode;
}

function docketFromResult(result: GovInfoSearchResult, courtCode: string): string | null {
  const text = `${result.title ?? ""} ${result.packageId ?? ""} ${result.granuleId ?? ""}`;
  const standard = /\b(?:No\.?\s*)?((?:\d{1,2}-)?\d{2}-\d{3,7})\b/i.exec(text)?.[1];
  if (standard) return standard;
  const packagePrefix = `USCOURTS-${courtCode}-`;
  if (result.packageId?.toUpperCase().startsWith(packagePrefix.toUpperCase())) {
    const raw = result.packageId.slice(packagePrefix.length).replaceAll("_", ":");
    return raw || null;
  }
  return null;
}

function pdfLink(result: GovInfoSearchResult): string | null {
  if (!result.packageId || !result.granuleId) return null;
  // GovInfo search returns api.govinfo.gov PDF URLs that require an API key.
  // Persist the equivalent public URL so workers can download it without
  // exposing a credential in the database or on public case pages.
  return `https://www.govinfo.gov/content/pkg/${encodeURIComponent(result.packageId)}/pdf/${encodeURIComponent(result.granuleId)}.pdf`;
}

function issuedDate(result: GovInfoSearchResult): string | null {
  const value = result.dateIssued ?? result.lastModified;
  const match = value?.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  return match ?? null;
}

async function fetchPage(govInfoCode: string, offsetMark: string): Promise<GovInfoSearchResponse> {
  const response = await fetch(`https://api.govinfo.gov/search?api_key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": userAgent },
    body: JSON.stringify({
      query: `collection:uscourts courtCode:${govInfoCode}`,
      pageSize: String(pageSize),
      offsetMark,
      resultLevel: "default",
      sorts: [
        { field: "publishdate", sortOrder: "DESC" },
        { field: "lastModified", sortOrder: "DESC" },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`GovInfo search returned HTTP ${response.status}: ${detail}`);
  }
  return await response.json() as GovInfoSearchResponse;
}

async function ingestCourt(courtCode: string) {
  const court = appellateCourtByCode(courtCode);
  if (!court) throw new Error(`Unknown appellate court ${courtCode}`);
  const [checkpoint] = await sql<{ offset_mark: string; status: string }[]>`
    INSERT INTO govinfo_appellate_checkpoint (court_code)
    VALUES (${courtCode})
    ON CONFLICT (court_code) DO UPDATE SET updated_at=now()
    RETURNING offset_mark, status
  `;
  if (!checkpoint || checkpoint.status === "complete") {
    return { court: courtCode, state: "complete", discovered: 0 };
  }

  const govInfoCode = govInfoCourtCode(courtCode);
  let offsetMark = checkpoint.offset_mark;
  let discovered = 0;
  let skipped = 0;
  let pages = 0;
  let totalAvailable: number | null = null;
  let oldestResultDate: string | null = null;
  try {
    for (; pages < pagesPerCourt; pages += 1) {
      const page = await fetchPage(govInfoCode, offsetMark);
      const results = page.results ?? [];
      totalAvailable = page.count ?? totalAvailable;
      const datedResults = results.map(issuedDate).filter((value): value is string => Boolean(value));
      const pageOldest = datedResults.sort()[0] ?? null;
      if (pageOldest && (!oldestResultDate || pageOldest < oldestResultDate)) oldestResultDate = pageOldest;
      let pageEnqueued = 0;
      let pageSkipped = 0;
      for (const result of results) {
        const documentUrl = pdfLink(result);
        const docketNumber = docketFromResult(result, govInfoCode);
        if (!documentUrl || !docketNumber) {
          skipped += 1;
          pageSkipped += 1;
          continue;
        }
        const caption = (result.title?.trim() || `GovInfo opinion ${docketNumber}`).slice(0, 500);
        const sourceListingUrl = result.summaryLink
          ?? `https://www.govinfo.gov/app/details/${result.packageId ?? result.granuleId ?? "USCOURTS"}`;
        const inserted = await sql<{ id: string }[]>`
          INSERT INTO appellate_ingestion_item (
            court_code, docket_number, caption, decided_on, document_url,
            source_listing_url, state
          ) VALUES (
            ${courtCode}, ${docketNumber}, ${caption}, ${issuedDate(result)},
            ${documentUrl}, ${sourceListingUrl}, 'discovered'
          )
          ON CONFLICT (court_code, document_url) DO UPDATE SET
            docket_number=COALESCE(appellate_ingestion_item.docket_number, EXCLUDED.docket_number),
            caption=CASE WHEN length(EXCLUDED.caption) > length(appellate_ingestion_item.caption)
              THEN EXCLUDED.caption ELSE appellate_ingestion_item.caption END,
            decided_on=COALESCE(appellate_ingestion_item.decided_on, EXCLUDED.decided_on),
            source_listing_url=EXCLUDED.source_listing_url,
            last_seen_at=now()
          RETURNING id
        `;
        if (inserted.length > 0) {
          discovered += 1;
          pageEnqueued += 1;
        }
      }

      const next = page.nextOffsetMark ?? page.offsetMark;
      const complete = results.length === 0 || !next || next === offsetMark;
      await sql`
        UPDATE govinfo_appellate_checkpoint SET
          offset_mark=${complete ? offsetMark : next ?? offsetMark},
          status=${complete ? "complete" : "running"},
          pages_processed=pages_processed+1,
          records_discovered=records_discovered+${results.length},
          records_enqueued=records_enqueued+${pageEnqueued},
          records_skipped=records_skipped+${pageSkipped},
          last_successful_retrieval=now(), last_error=NULL, updated_at=now()
        WHERE court_code=${courtCode}
      `;
      if (complete) break;
      offsetMark = next ?? offsetMark;
      if (apiKey === "DEMO_KEY") await sleep(2_000);
    }
    return { court: courtCode, govInfoCourtCode: govInfoCode, state: "running", pages, discovered, skipped, totalAvailable, oldestResultDate, offsetMark };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await sql`
      UPDATE govinfo_appellate_checkpoint SET status='failed',
        consecutive_failures=consecutive_failures+1, last_error=${message}, updated_at=now()
      WHERE court_code=${courtCode}
    `;
    return { court: courtCode, govInfoCourtCode: govInfoCode, state: "failed", pages, discovered, skipped, error: message };
  }
}

try {
  if (requestedCourts.length === 0) throw new Error("--court must name at least one circuit");
  const unknownCourts = requestedCourts.filter((court) => !appellateCourtByCode(court));
  if (unknownCourts.length > 0) throw new Error(`Unknown appellate court(s): ${unknownCourts.join(", ")}`);
  // Scheduler-owned groups deliberately keep DEMO_KEY below GovInfo's ten
  // searches per rolling hour. Explicit --court values are never silently
  // rotated: an interrupted group resumes exactly its own circuit cursors.
  const courts = requestedCourts;
  const results = [];
  for (const courtCode of courts) {
    results.push(await ingestCourt(courtCode));
    if (apiKey === "DEMO_KEY") await sleep(2_000);
  }
  console.log(JSON.stringify({
    lane: "govinfo-appellate-backfill",
    apiCredential: apiKey === "DEMO_KEY" ? "demo" : "configured",
    historicalOrder: "newest-to-oldest",
    pageSize, requestedPagesPerCourt, pagesPerCourt,
    scheduledCourts: courts,
    results,
    progress: results.map((result) => ({
      court: result.court,
      govInfoCourtCode: result.govInfoCourtCode,
      state: result.state,
      discovered: result.discovered ?? 0,
      pages: result.pages ?? 0,
      nextCheckpoint: result.offsetMark ?? null,
      totalAvailable: result.totalAvailable ?? null,
      oldestResultDate: result.oldestResultDate ?? null,
      blocked: result.state === "failed" ? 1 : 0,
    })),
  }));
} finally {
  await closeDb();
}
