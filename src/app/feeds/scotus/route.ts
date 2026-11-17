import { unstable_cache } from "next/cache";
import { db } from "@/db/client";
import { siteOrigin } from "@/lib/config/site-url";
import { listScotusActivity } from "@/modules/scotus/application/scotus-activity-feed";
import { feedCacheControl } from "@/lib/http/edge-cache";
import { atomFeed } from "@/modules/scotus/domain/activity-feed";

export const dynamic = "force-dynamic";

const loadActivity = unstable_cache(
  () => listScotusActivity(db()),
  ["scotus-activity-feed"],
  { revalidate: 300 },
);

export async function GET() {
  const origin = siteOrigin();
  const selfUrl = `${origin}/feeds/scotus`;
  try {
    const items = await loadActivity();
    const body = atomFeed({
      id: selfUrl, title: "Jurvio Supreme Court activity", selfUrl,
      subtitle: "Published docket lines from the last 90 days, recent published opinions on Jurvio, live emergency applications, and stored order-list rows. Unpublished new dockets are not included. Not a complete record of the Court.",
      updated: items[0]?.updated ?? new Date().toISOString(), items,
    });
    return new Response(body, { status: 200, headers: { "Content-Type": "application/atom+xml; charset=utf-8", "Cache-Control": feedCacheControl(200) } });
  } catch {
    return new Response("This feed is temporarily unavailable.\n", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": feedCacheControl(503) } });
  }
}
