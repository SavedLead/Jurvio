import { unstable_cache } from "next/cache";
import { db } from "@/db/client";
import {
  listCaseSitemapRecords,
  listDirectorySitemapRecords,
  listOpinionSitemapRecords,
  readSitemapBoundaries,
  sitemapPageBounds,
  type DirectorySitemapKind,
  type SitemapBoundaries,
  type SitemapRecord,
} from "@/modules/discovery/application/sitemaps";

export const SITEMAP_REVALIDATE_SECONDS = 900;

const boundaryKey: Record<DirectorySitemapKind, keyof SitemapBoundaries> = {
  parties: "parties",
  "law-firms": "lawFirms",
  courts: "courts",
  judges: "judges",
  "government-litigation": "governmentLitigation",
};

export const loadSitemapBoundaries = unstable_cache(
  async () => readSitemapBoundaries(db()),
  ["public-sitemap-boundaries-v1"],
  { revalidate: SITEMAP_REVALIDATE_SECONDS },
);

async function recordsFor(starts: readonly string[], page: number, load: (start: string, end: string | null) => Promise<SitemapRecord[]>) {
  const bounds = sitemapPageBounds(starts, page);
  if (!bounds) return [];
  return load(bounds.start, bounds.end);
}

export const loadCachedCaseSitemap = unstable_cache(
  async (page: number) => recordsFor((await loadSitemapBoundaries()).cases, page, (start, end) => listCaseSitemapRecords(db(), start, end)),
  ["public-sitemap-cases-v2"],
  { revalidate: SITEMAP_REVALIDATE_SECONDS },
);

export const loadCachedOpinionSitemap = unstable_cache(
  async (page: number) => recordsFor((await loadSitemapBoundaries()).opinions, page, (start, end) => listOpinionSitemapRecords(db(), start, end)),
  ["public-sitemap-opinions-v2"],
  { revalidate: SITEMAP_REVALIDATE_SECONDS },
);

export const loadCachedDirectorySitemap = unstable_cache(
  async (kind: DirectorySitemapKind, page: number) => {
    const boundaries = await loadSitemapBoundaries();
    return recordsFor(boundaries[boundaryKey[kind]], page, (start, end) => listDirectorySitemapRecords(db(), kind, start, end));
  },
  ["public-sitemap-directory-v2"],
  { revalidate: SITEMAP_REVALIDATE_SECONDS },
);
