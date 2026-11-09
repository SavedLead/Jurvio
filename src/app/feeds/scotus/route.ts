import { db } from "@/db/client";
import { siteOrigin } from "@/lib/config/site-url";
import { listScotusActivity } from "@/modules/scotus/application/scotus-activity-feed";
import { atomFeed } from "@/modules/scotus/domain/activity-feed";

export const dynamic = "force-dynamic";

export async function GET() {
  const origin = siteOrigin();
  const selfUrl = `${origin}/feeds/scotus`;
  const items = await listScotusActivity(db());
  const body = atomFeed({
    id: selfUrl, title: "Jurvio Supreme Court activity", selfUrl,
    subtitle: "Published docket lines, opinions on Jurvio, live emergency applications, and stored order-list rows. Not a complete record of the Court.",
    updated: items[0]?.updated ?? new Date().toISOString(), items,
  });
  return new Response(body, { headers: { "Content-Type": "application/atom+xml; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
