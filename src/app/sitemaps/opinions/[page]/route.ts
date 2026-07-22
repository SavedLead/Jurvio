import { db } from "@/db/client";
import { siteOrigin } from "@/lib/config/site-url";
import { listOpinionSitemapRecords } from "@/modules/discovery/application/sitemaps";
import { xmlEscape, xmlResponse } from "@/modules/discovery/http/xml";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ page: string }> }) {
  const page = Number((await params).page);
  if (!Number.isInteger(page) || page < 1) return new Response("Not found", { status: 404 });
  const origin = siteOrigin();
  const records = await listOpinionSitemapRecords(db(), page);
  const urls = records.map((record) => `<url><loc>${xmlEscape(origin + record.path)}</loc><lastmod>${xmlEscape(record.updatedAt)}</lastmod></url>`).join("");
  return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
}
