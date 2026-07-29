export interface FederalCourtSource {
  name: string;
  jurvioCourtCode: string;
  officialCourtCode: string;
  courtType: "district" | "appellate" | "bankruptcy";
  circuit: string;
  officialWebsite: string;
  cmecfBaseUrl: string;
  rssUrl: string | null;
  rssAvailable: boolean;
  rssCoverageWindowHours: number | null;
  includedEventCategories: string[];
  pacerCourtId: string;
  opinionUrl: string | null;
  calendarUrl: string | null;
  timeZone: string;
  pollingMinutes: number;
  adapterType: "cmecf-rss-v1";
}

export const FEDERAL_COURT_REGISTRY: readonly FederalCourtSource[] = [{
  name: "United States District Court for the Western District of Texas",
  jurvioCourtCode: "txwd",
  officialCourtCode: "txwd",
  courtType: "district",
  circuit: "5",
  officialWebsite: "https://www.txwd.uscourts.gov",
  cmecfBaseUrl: "https://ecf.txwd.uscourts.gov",
  rssUrl: "https://ecf.txwd.uscourts.gov/cgi-bin/rss_outside.pl",
  rssAvailable: true,
  rssCoverageWindowHours: 24,
  includedEventCategories: ["all"],
  pacerCourtId: "txwd",
  opinionUrl: null,
  calendarUrl: "https://www.txwd.uscourts.gov/court-information/court-calendars/",
  timeZone: "America/Chicago",
  pollingMinutes: 5,
  adapterType: "cmecf-rss-v1",
}, {
  name: "United States District Court for the Southern District of New York",
  jurvioCourtCode: "nysd",
  officialCourtCode: "nysd",
  courtType: "district",
  circuit: "2",
  officialWebsite: "https://www.nysd.uscourts.gov",
  cmecfBaseUrl: "https://ecf.nysd.uscourts.gov",
  rssUrl: "https://ecf.nysd.uscourts.gov/cgi-bin/rss_outside.pl",
  rssAvailable: true,
  rssCoverageWindowHours: 24,
  includedEventCategories: [
    "answers", "appeals", "complaints", "discovery", "minutes", "motions",
    "notices", "orders", "pleas", "responses", "service", "transfers", "trials",
  ],
  pacerCourtId: "nysd",
  opinionUrl: "https://www.nysd.uscourts.gov/courtweb",
  calendarUrl: "https://www.nysd.uscourts.gov/court-calendars",
  timeZone: "America/New_York",
  pollingMinutes: 5,
  adapterType: "cmecf-rss-v1",
}, {
  name: "United States District Court for the District of New Jersey",
  jurvioCourtCode: "njd",
  officialCourtCode: "njd",
  courtType: "district",
  circuit: "3",
  officialWebsite: "https://www.njd.uscourts.gov",
  cmecfBaseUrl: "https://ecf.njd.uscourts.gov",
  rssUrl: "https://ecf.njd.uscourts.gov/cgi-bin/rss_outside.pl",
  rssAvailable: true,
  rssCoverageWindowHours: 24,
  includedEventCategories: ["all"],
  pacerCourtId: "njd",
  opinionUrl: "https://www.njd.uscourts.gov/opinions",
  calendarUrl: "https://www.njd.uscourts.gov/court-info/court-calendars",
  timeZone: "America/New_York",
  pollingMinutes: 5,
  adapterType: "cmecf-rss-v1",
}] as const;

export function federalCourtByCode(code: string): FederalCourtSource | null {
  return FEDERAL_COURT_REGISTRY.find((court) =>
    court.officialCourtCode.toLowerCase() === code.trim().toLowerCase()) ?? null;
}
