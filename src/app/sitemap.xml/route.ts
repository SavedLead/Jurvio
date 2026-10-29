import { siteOrigin } from "@/lib/config/site-url";
import { type DirectorySitemapKind, type SitemapBoundaries } from "@/modules/discovery/application/sitemaps";
import { xmlEscape, xmlResponse } from "@/modules/discovery/http/xml";
import { loadSitemapBoundaries } from "@/app/sitemaps/cached";

export const dynamic = "force-dynamic";

const directoryKinds: Array<[DirectorySitemapKind, keyof SitemapBoundaries]> = [
  ["parties", "parties"],
  ["law-firms", "lawFirms"],
  ["courts", "courts"],
  ["judges", "judges"],
  ["government-litigation", "governmentLitigation"],
];

export async function GET() {
  const boundaries = await loadSitemapBoundaries();
  const origin = siteOrigin();
  const pages = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, index) => `${origin}${prefix}/${index + 1}`);
  const locations = [
    `${origin}/sitemaps/static.xml`,
    ...pages("/sitemaps/cases", boundaries.cases.length),
    ...pages("/sitemaps/opinions", boundaries.opinions.length),
    ...directoryKinds.flatMap(([kind, key]) => pages(`/sitemaps/directory/${kind}`, boundaries[key].length)),
  ];
  const body = locations.map((location) => `<sitemap><loc>${xmlEscape(location)}</loc></sitemap>`).join("");
  return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</sitemapindex>`);
}
