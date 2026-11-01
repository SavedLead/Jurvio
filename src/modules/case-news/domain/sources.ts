// News sources for case pages and the terms that allow each use. Recorded here
// so a reviewer can see why a source is on, off, or link-only. Checked 2026-10-31.
// Display rule for every source: headline, outlet, date, link and at most a short
// snippet the source itself provides. Article text is never fetched or stored.

export type CaseNewsSourceId = "gdelt" | "courthousenews_rss" | "google_news_rss";

export interface CaseNewsSourceInfo {
  id: CaseNewsSourceId | string;
  name: string;
  enabled: boolean;
  terms: string;
  termsUrl: string;
}

export const CASE_NEWS_SOURCES: readonly CaseNewsSourceInfo[] = [
  {
    id: "gdelt",
    name: "GDELT DOC 2.0 API",
    enabled: true,
    terms: "Free for unlimited academic, commercial or governmental use; any use must cite the GDELT Project and link to gdeltproject.org. Polite limit: one request every 5 seconds. Returns URL, headline, domain and date only (no snippet).",
    termsUrl: "https://www.gdeltproject.org/about.html#termsofuse",
  },
  {
    id: "courthousenews_rss",
    name: "Courthouse News Service RSS",
    enabled: true,
    terms: "CNS invites sites to link to it and to use its RSS feeds on their website, provided nothing implies CNS sponsorship; CNS may revoke feed use. Headline, link, date and the feed's own one-sentence description are shown with credit.",
    termsUrl: "https://www.courthousenews.com/terms-of-use/",
  },
  {
    id: "google_news_rss",
    name: "Google News RSS",
    enabled: true,
    terms: "Enabled 2026-11-01 at the owner's request as a keyless second matcher for SCOTUS and appeals cases (one search per case, 8 s apart, ~30 per run). Google's feed terms describe personal, non-commercial feed-reader use; we store and show only the headline, the feed's own short description (truncated), outlet name, link and date, and never fetch article text. Disable with --no-google-news if Google objects.",
    termsUrl: "https://news.google.com/rss",
  },
  {
    id: "abajournal_rss",
    name: "ABA Journal RSS",
    enabled: false,
    terms: "Not ingested as a feed: ABA terms limit content to noncommercial personal use. Linking to articles is free, so ABA Journal stories found through GDELT are linked by headline only.",
    termsUrl: "https://www.abajournal.com/reprint",
  },
  {
    id: "jdsupra_rss",
    name: "JD Supra RSS",
    enabled: false,
    terms: "Not used without a syndication agreement: JD Supra terms bar republishing customer content without prior written consent.",
    termsUrl: "https://www.jdsupra.com/terms/termsandconditions.aspx",
  },
  {
    id: "reuters_ap_bloomberg_law360",
    name: "Reuters, AP, Bloomberg Law, Law360, Law.com feeds",
    enabled: false,
    terms: "No public RSS licensed for third-party sites (Reuters retired public RSS; AP, Bloomberg Law, Law360 and Law.com syndicate under paid licenses). Their stories are linked by headline when GDELT finds them.",
    termsUrl: "https://www.gdeltproject.org/",
  },
];
