export type GovernmentAgency = "doj" | "sec" | "ftc" | "osha" | "executive_office";
export type GovernmentSourceKind = "press_release" | "litigation_release" | "enforcement_release" | "news_release" | "executive_order";

export interface OfficialSourceRecord {
  sourceRecordId: string;
  sourceUrl: string;
  title: string;
  publishedAt: string | null;
  officialText: string;
}

export interface OfficialGovernmentSourceProvider {
  readonly code: string;
  readonly agency: GovernmentAgency;
  readonly sourceKind: GovernmentSourceKind;
  readonly officialBaseUrl: string;
  discover(cursor?: string): Promise<{ records: OfficialSourceRecord[]; nextCursor: string | null }>;
}

export const officialGovernmentSources = [
  { code: "doj-press-releases", agency: "doj", sourceKind: "press_release", officialBaseUrl: "https://www.justice.gov/news" },
  { code: "sec-litigation-releases", agency: "sec", sourceKind: "litigation_release", officialBaseUrl: "https://www.sec.gov/enforcement-litigation/litigation-releases" },
  { code: "ftc-press-releases", agency: "ftc", sourceKind: "enforcement_release", officialBaseUrl: "https://www.ftc.gov/news-events/news/press-releases" },
  { code: "osha-news-releases", agency: "osha", sourceKind: "news_release", officialBaseUrl: "https://www.osha.gov/news/newsreleases" },
  { code: "federal-register-executive-orders", agency: "executive_office", sourceKind: "executive_order", officialBaseUrl: "https://www.federalregister.gov/presidential-documents/executive-orders" },
] as const satisfies ReadonlyArray<Omit<OfficialGovernmentSourceProvider, "discover">>;
