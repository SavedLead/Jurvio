import { isRestrictedDocketText } from "@/modules/ingestion/domain/federal-stream";

/**
 * Public read-only Supreme Court feeds. These are not email or SMS alerts.
 * Administration items use the existing automatic label: a federal-government
 * applicant name plus the presidential term of the filing date. That match is
 * approximate and has not been reviewed case by case.
 */
export const ADMINISTRATION_FEED_NOTE =
  "Automatic and approximate. These are emergency applications whose applicant name matched a federal-government pattern. The administration is the presidential term of the filing date. This is not a reviewed list of administration-related cases.";

export interface ActivityFeedItem {
  id: string;
  title: string;
  url: string;
  updated: string;
  summary: string;
  category: string;
}

export function isPublicFeedText(value: string): boolean {
  return !isRestrictedDocketText(value);
}

export function publicFeedItems(items: readonly ActivityFeedItem[]): ActivityFeedItem[] {
  return items.filter((item) => isPublicFeedText(`${item.title} ${item.summary}`));
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function atomFeed(input: {
  id: string;
  title: string;
  selfUrl: string;
  subtitle: string;
  updated: string;
  items: readonly ActivityFeedItem[];
}): string {
  const items = publicFeedItems(input.items).slice(0, 40).map((item) => `  <entry>
    <id>${escapeXml(item.id)}</id>
    <title>${escapeXml(item.title)}</title>
    <updated>${escapeXml(item.updated)}</updated>
    <link href="${escapeXml(item.url)}" rel="alternate"/>
    <category term="${escapeXml(item.category)}"/>
    <summary>${escapeXml(item.summary)}</summary>
  </entry>`).join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${escapeXml(input.id)}</id>
  <title>${escapeXml(input.title)}</title>
  <subtitle>${escapeXml(input.subtitle)}</subtitle>
  <updated>${escapeXml(input.updated)}</updated>
  <link href="${escapeXml(input.selfUrl)}" rel="self"/>
${items}
</feed>
`;
}
