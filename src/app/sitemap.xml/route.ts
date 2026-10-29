import { db } from "@/db/client";
import { siteOrigin } from "@/lib/config/site-url";
import { xmlResponse } from "@/modules/discovery/http/xml";
import {
  fallbackSitemapIndex,
  readSitemapDocument,
  sitemapBodyOrFallback,
} from "@/modules/discovery/application/sitemap-snapshot";

export const dynamic = "force-dynamic";

export async function GET() {
  const fallback = fallbackSitemapIndex(siteOrigin());
  try {
    const stored = await readSitemapDocument(db(), "index", 0);
    return xmlResponse(sitemapBodyOrFallback(stored, fallback));
  } catch (error) {
    console.error("sitemap index unavailable", error);
    return xmlResponse(fallback);
  }
}
