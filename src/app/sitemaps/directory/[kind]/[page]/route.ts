import { siteOrigin } from "@/lib/config/site-url";
import { type DirectorySitemapKind } from "@/modules/discovery/application/sitemaps";
import { xmlEscape, xmlResponse } from "@/modules/discovery/http/xml";
import { loadCachedDirectorySitemap } from "@/app/sitemaps/cached";

export const revalidate = 900;

const supportedKinds = new Set<DirectorySitemapKind>([
  "parties",
  "law-firms",
  "courts",
  "judges",
  "government-litigation",
]);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ kind: string; page: string }> },
) {
  const { kind: rawKind, page: rawPage } = await params;
  const page = Number(rawPage);
  if (!supportedKinds.has(rawKind as DirectorySitemapKind) || !Number.isInteger(page) || page < 1) {
    return new Response("Not found", { status: 404 });
  }
  const kind = rawKind as DirectorySitemapKind;
  const origin = siteOrigin();
  const records = await loadCachedDirectorySitemap(kind, page);
  const urls = records
    .map((record) => `<url><loc>${xmlEscape(origin + record.path)}</loc><lastmod>${xmlEscape(record.updatedAt)}</lastmod></url>`)
    .join("");
  return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
}
