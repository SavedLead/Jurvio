/**
 * The court x source catalog: every free source Jurvio knows for a federal
 * court, whether it is polled, and why not when it is not. The court-freshness
 * job writes this into court_source; the health page and the matrix report
 * join it with court_fetch_log. District PACER RSS rows come from
 * direct_court_registry (the database is the switch for those).
 *
 * Pure data, no I/O.
 */
import { circuitAdapter } from "@/modules/ingestion/providers/appellate/adapters";
import { APPELLATE_RSS_COURTS, appellateRssUrl } from "@/modules/ingestion/providers/appellate/pacer-rss";
import { SITE_OPINION_SOURCES } from "@/modules/ingestion/providers/courts/site-opinions";
import { COURTLISTENER_FEED_COURTS, courtListenerFeedUrl } from "@/modules/ingestion/providers/courts/courtlistener-feed";
import { APPELLATE_COURT_REGISTRY } from "@/modules/ingestion/providers/appellate/registry";

export type CourtSourceKey =
  | "district_rss"
  | "coa_feed"
  | "appellate_official"
  | "govinfo"
  | "court_site"
  | "appellate_pacer_rss"
  | "courtlistener_feed"
  | "pacer_free_opinions";

export const COURT_SOURCE_LABELS: Readonly<Record<CourtSourceKey, string>> = {
  district_rss: "PACER public RSS",
  coa_feed: "Circuit opinion feed (live)",
  appellate_official: "Circuit opinion pages (full text)",
  govinfo: "GovInfo USCOURTS opinions",
  court_site: "Court website opinions/orders",
  appellate_pacer_rss: "Appellate PACER RSS",
  courtlistener_feed: "CourtListener court opinion feed",
  pacer_free_opinions: "PACER written-opinions report",
};

export interface CourtSourceRow {
  courtCode: string;
  source: CourtSourceKey;
  url: string | null;
  available: boolean;
  enabled: boolean;
  note: string | null;
}

export const CIRCUIT_CODES = ["ca1", "ca2", "ca3", "ca4", "ca5", "ca6", "ca7", "ca8", "ca9", "ca10", "ca11", "cadc", "cafc"] as const;

const PACER_LOGIN_NOTE = "needs a PACER account (the report itself is free); follow-up for David";

/** Static rows for courts of appeals. District rows are added by catalogRows(districtCodes). */
export function circuitCatalogRows(): CourtSourceRow[] {
  const rows: CourtSourceRow[] = [];
  for (const court of CIRCUIT_CODES) {
    const feeds = circuitAdapter(court)?.requests(new Date()) ?? [];
    rows.push({
      courtCode: court, source: "coa_feed", url: feeds[0]?.url ?? null, available: feeds.length > 0, enabled: feeds.length > 0,
      note: feeds.length > 1 ? `${feeds.length} listings: ${feeds.map((feed) => feed.label).join(", ")}` : null,
    });
    rows.push(govinfoRow(court));
    const rss = (APPELLATE_RSS_COURTS as readonly string[]).includes(court);
    rows.push({
      courtCode: court, source: "appellate_pacer_rss", url: appellateRssUrl(court), available: rss, enabled: rss,
      note: rss ? "public NextGen RSS: orders, opinions, judgments" : "court answers \"not configured for feed\" (checked 2026-10-31)",
    });
    const official = APPELLATE_COURT_REGISTRY.find((entry) => entry.code === court);
    rows.push({
      courtCode: court, source: "appellate_official", url: official?.opinionsUrl ?? null,
      available: Boolean(official), enabled: Boolean(official?.enabled), note: null,
    });
  }
  return rows;
}

const GOVINFO_COURT: Readonly<Record<string, string>> = { cadc: "caDC", cafc: "ca13" };

/** GovInfo USCOURTS: read for every court by the govinfo-daily job. */
function govinfoRow(court: string): CourtSourceRow {
  return {
    courtCode: court, source: "govinfo",
    url: `https://www.govinfo.gov/app/collection/uscourts/${GOVINFO_COURT[court] ?? court}`,
    available: true, enabled: true, note: "daily via api.govinfo.gov collections; cross-checked (govinfo_crosscheck)",
  };
}

/** Rows that apply to every district (beyond the RSS rows read from direct_court_registry). */
export function districtCatalogRows(districtCodes: readonly string[]): CourtSourceRow[] {
  return districtCodes.flatMap((court) => [
    govinfoRow(court),
    ...SITE_OPINION_SOURCES.filter((source) => source.courtCode === court).map((source) => ({
      courtCode: court, source: "court_site" as const, url: source.url, available: true, enabled: true,
      note: "court website opinion list",
    })),
    ...(COURTLISTENER_FEED_COURTS as readonly string[]).includes(court) ? [{
      courtCode: court, source: "courtlistener_feed" as const, url: courtListenerFeedUrl(court), available: true, enabled: true,
      note: "public Atom feed of the court's newest opinions (no public PACER RSS, no GovInfo packages)",
    }] : [],
    {
      courtCode: court, source: "pacer_free_opinions" as const,
      url: `https://ecf.${court}.uscourts.gov/cgi-bin/WrtOpRpt.pl`, available: true, enabled: false, note: PACER_LOGIN_NOTE,
    },
  ]);
}

export function catalogRows(districtCodes: readonly string[]): CourtSourceRow[] {
  return [...circuitCatalogRows(), ...districtCatalogRows(districtCodes)];
}
