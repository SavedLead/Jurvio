import { db } from "@/db/client";
import { xmlResponse } from "@/modules/discovery/http/xml";
import { emptySitemapUrlset, readSitemapDocument, sitemapBodyOrFallback } from "@/modules/discovery/application/sitemap-snapshot";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ page: string }> }) {
  const page = Number((await params).page);
  if (!Number.isInteger(page) || page < 1) return new Response("Not found", { status: 404 });
  try {
    const stored = await readSitemapDocument(db(), "cases", page);
    return xmlResponse(sitemapBodyOrFallback(stored, emptySitemapUrlset()));
  } catch (error) {
    console.error("case sitemap unavailable", error);
    return xmlResponse(emptySitemapUrlset());
  }
}
