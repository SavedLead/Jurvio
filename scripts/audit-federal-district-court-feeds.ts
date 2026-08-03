/**
 * Builds a current official-source map for every active U.S. district court.
 *
 * The PACER CM/ECF Court Lookup JSON is authoritative for active courts and
 * their CM/ECF login URLs. Public RSS is probed conservatively; a missing or
 * inaccessible feed is not treated as a failure of the court, only as a signal
 * to use the authenticated court-report/PCL reconciliation lane.
 *
 * Usage: npx tsx scripts/audit-federal-district-court-feeds.ts > district-court-coverage.json
 */
const PACER_COURT_DIRECTORY =
  "https://pacer.uscourts.gov/file-case/court-cmecf-lookup/data.json";
const MAX_CONCURRENT = 3;
const TIMEOUT_MS = 15_000;

type PacerCourt = {
  title?: string;
  court_name?: string;
  court_id?: string;
  type?: string;
  login_url?: string;
  web_url?: string;
  circuit?: string;
};

type DirectoryResponse = { meta?: { last_updated?: string }; data?: PacerCourt[] };

function candidateRssUrl(loginUrl: string) {
  return new URL("/cgi-bin/rss_outside.pl", loginUrl).toString();
}

async function probeRss(rssUrl: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(rssUrl, {
      headers: {
        accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8",
        "user-agent": process.env.INGESTION_USER_AGENT ?? "Jurvio/0.1 court-source-audit",
      },
      redirect: "error",
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") ?? "";
    // Read at most a small prefix: this is a capability check, never a bulk pull.
    const prefix = (await response.text()).slice(0, 2_048);
    return {
      rssUrl,
      available: response.ok && /(?:rss|xml)/i.test(contentType) &&
        /<(?:\?xml|rss|feed)\b/i.test(prefix),
      status: response.status,
      contentType,
    };
  } catch (error) {
    return {
      rssUrl,
      available: false,
      status: null,
      contentType: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function mapWithConcurrency<T, R>(values: readonly T[], work: (value: T) => Promise<R>) {
  const output: R[] = [];
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor++;
      output[index] = await work(values[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT, values.length) }, worker));
  return output;
}

async function main() {
  const response = await fetch(PACER_COURT_DIRECTORY, {
    headers: { accept: "application/json", "user-agent": "Jurvio/0.1 court-source-audit" },
  });
  if (!response.ok) throw new Error(`PACER court directory returned HTTP ${response.status}`);
  const directory = await response.json() as DirectoryResponse;
  const courts = (directory.data ?? []).filter((court) =>
    court.type === "District" && court.court_id?.endsWith("DC") && Boolean(court.login_url));

  // There are 94 active federal judicial districts. Stop if PACER changes its
  // classification rather than silently publishing incomplete coverage.
  if (courts.length !== 94) {
    throw new Error(`Expected 94 active district courts, received ${courts.length}`);
  }

  const mapped = await mapWithConcurrency(courts, async (court) => {
    const rssUrl = candidateRssUrl(court.login_url!);
    const rss = await probeRss(rssUrl);
    return {
      pacerCourtId: court.court_id,
      name: court.court_name ?? court.title ?? court.court_id,
      circuit: court.circuit ?? null,
      officialCourtPage: court.web_url ?? null,
      cmecfUrl: court.login_url,
      newCasePrimary: rss.available ? "official_cmecf_rss" : "authenticated_cmecf_new_case_report",
      newCaseSecondary: "pacer_case_locator_daily_reconciliation",
      writtenOpinions: "authenticated_cmecf_written_opinions_report",
      rss,
    };
  });

  process.stdout.write(JSON.stringify({
    source: PACER_COURT_DIRECTORY,
    directoryUpdatedAt: directory.meta?.last_updated ?? null,
    generatedAt: new Date().toISOString(),
    courtCount: mapped.length,
    rssAvailableCount: mapped.filter((court) => court.rss.available).length,
    courts: mapped,
  }, null, 2) + "\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
