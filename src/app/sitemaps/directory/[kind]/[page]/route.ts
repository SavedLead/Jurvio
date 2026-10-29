import { db } from "@/db/client";
import { type DirectorySitemapKind } from "@/modules/discovery/application/sitemaps";
import { emptySitemapUrlset, readSitemapDocument, sitemapBodyOrFallback } from "@/modules/discovery/application/sitemap-snapshot";
import { xmlResponse } from "@/modules/discovery/http/xml";

export const dynamic = "force-dynamic";

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
  try {
    const stored = await readSitemapDocument(db(), rawKind, page);
    return xmlResponse(sitemapBodyOrFallback(stored, emptySitemapUrlset()));
  } catch (error) {
    console.error("directory sitemap unavailable", error);
    return xmlResponse(emptySitemapUrlset());
  }
}
