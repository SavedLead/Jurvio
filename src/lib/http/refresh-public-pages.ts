import { siteOrigin } from "@/lib/config/site-url";

/** Pages whose edge copy is warmed after a publish. Search stays uncached. */
export const SHARED_PUBLIC_PATHS = [
  "/",
  "/cases",
  "/supreme-court",
  "/supreme-court/emergency",
  "/feeds/scotus",
  "/feeds/scotus/emergency",
  "/feeds/scotus/administration",
] as const;

const CASE_PUBLIC_ID = /^jv-[a-z0-9]{8,10}$/i;

export function pagesToRefresh(casePublicIds: readonly string[] = []): string[] {
  const origin = siteOrigin().replace(/\/$/, "");
  const urls = SHARED_PUBLIC_PATHS.map((path) => `${origin}${path}`);
  for (const id of casePublicIds) {
    if (CASE_PUBLIC_ID.test(id)) urls.push(`${origin}/case/${id}`);
  }
  return [...new Set(urls)].slice(0, 30);
}

export interface RefreshPublishedPagesOptions {
  casePublicIds?: readonly string[];
  fetchImpl?: typeof fetch;
}

/**
 * Best-effort. A missing Cloudflare token still prefetches, which stores a
 * fresh edge copy. Purge runs only when both CLOUDFLARE_API_TOKEN and
 * CLOUDFLARE_ZONE_ID are set, so a changed page is not served for the rest of
 * the stale-while-revalidate window. Failures never affect the publish.
 */
export async function refreshPublishedPages(options: RefreshPublishedPagesOptions = {}): Promise<void> {
  const urls = pagesToRefresh(options.casePublicIds ?? []);
  if (urls.length === 0) return;
  const fetchImpl = options.fetchImpl ?? fetch;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const zone = process.env.CLOUDFLARE_ZONE_ID;
  if (token && zone) {
    await fetchImpl(`https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(zone)}/purge_cache`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ files: urls }),
    }).catch(() => undefined);
  }
  await Promise.all(urls.map((url) => fetchImpl(url, {
    method: "GET",
    headers: { "User-Agent": "JurvioCacheWarm/1.0", "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(8_000),
  }).catch(() => undefined)));
}
