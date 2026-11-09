import { unstable_cache } from "next/cache";
import { db } from "@/db/client";
import { siteOrigin } from "@/lib/config/site-url";
import { listAdministrationFeed } from "@/modules/scotus/application/scotus-activity-feed";
import { ADMINISTRATION_FEED_NOTE, atomFeed } from "@/modules/scotus/domain/activity-feed";

export const dynamic = "force-dynamic";

const loadAdministration = unstable_cache(
  () => listAdministrationFeed(db()),
  ["scotus-administration-feed"],
  { revalidate: 300 },
);

export async function GET() {
  const origin = siteOrigin();
  const selfUrl = `${origin}/feeds/scotus/administration`;
  const items = await loadAdministration();
  const body = atomFeed({
    id: selfUrl, title: "Jurvio administration-related emergency applications", selfUrl,
    subtitle: ADMINISTRATION_FEED_NOTE,
    updated: items[0]?.updated ?? new Date().toISOString(), items,
  });
  return new Response(body, { headers: { "Content-Type": "application/atom+xml; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
