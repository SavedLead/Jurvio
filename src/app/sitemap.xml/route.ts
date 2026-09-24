import { unstable_cache } from "next/cache";
import { db } from "@/db/client";
import { siteOrigin } from "@/lib/config/site-url";
import {
  countPublicSitemapRecords,
  SITEMAP_PAGE_SIZE,
  type DirectorySitemapKind,
} from "@/modules/discovery/application/sitemaps";
import { xmlEscape, xmlResponse } from "@/modules/discovery/http/xml";

export const dynamic = "force-dynamic";

// The counts query scans the published corpus. Reuse a snapshot across crawler
// requests; the sitemap can safely lag publication by up to fifteen minutes.
const cachedCounts = unstable_cache(
  async () => countPublicSitemapRecords(db()),
  ["public-sitemap-counts"],
  { revalidate: 900 },
);

const directoryCounts: Array<[DirectorySitemapKind, "parties" | "lawFirms" | "courts" | "judges" | "governmentLitigation"]> = [
  ["parties", "parties"],
  ["law-firms", "lawFirms"],
  ["courts", "courts"],
  ["judges", "judges"],
  ["government-litigation", "governmentLitigation"],
];

export async function GET() {
  const counts = await cachedCounts();
  const origin = siteOrigin();
  const locations = [
    `${origin}/sitemaps/static.xml`,
    ...Array.from({ length: Math.ceil(counts.cases / SITEMAP_PAGE_SIZE) }, (_, index) => `${origin}/sitemaps/cases/${index + 1}`),
    ...Array.from({ length: Math.ceil(counts.opinions / SITEMAP_PAGE_SIZE) }, (_, index) => `${origin}/sitemaps/opinions/${index + 1}`),
    ...directoryCounts.flatMap(([kind, countKey]) =>
      Array.from(
        { length: Math.ceil(counts[countKey] / SITEMAP_PAGE_SIZE) },
        (_, index) => `${origin}/sitemaps/directory/${kind}/${index + 1}`,
      ),
    ),
  ];
  const body = locations.map((location) => `<sitemap><loc>${xmlEscape(location)}</loc></sitemap>`).join("");
  return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</sitemapindex>`);
}
