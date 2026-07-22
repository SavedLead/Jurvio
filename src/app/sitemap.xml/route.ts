import { db } from "@/db/client";
import { siteOrigin } from "@/lib/config/site-url";
import { countPublicSitemapRecords, SITEMAP_PAGE_SIZE } from "@/modules/discovery/application/sitemaps";
import { xmlEscape, xmlResponse } from "@/modules/discovery/http/xml";

export const dynamic = "force-dynamic";

export async function GET() {
  const counts = await countPublicSitemapRecords(db());
  const origin = siteOrigin();
  const locations = [
    `${origin}/sitemaps/static.xml`,
    ...Array.from({ length: Math.ceil(counts.cases / SITEMAP_PAGE_SIZE) }, (_, index) => `${origin}/sitemaps/cases/${index + 1}`),
    ...Array.from({ length: Math.ceil(counts.opinions / SITEMAP_PAGE_SIZE) }, (_, index) => `${origin}/sitemaps/opinions/${index + 1}`),
  ];
  const body = locations.map((location) => `<sitemap><loc>${xmlEscape(location)}</loc></sitemap>`).join("");
  return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</sitemapindex>`);
}
