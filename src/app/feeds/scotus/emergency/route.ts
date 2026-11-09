import { unstable_cache } from "next/cache";
import { db } from "@/db/client";
import { siteOrigin } from "@/lib/config/site-url";
import { listEmergencyFeed } from "@/modules/scotus/application/scotus-activity-feed";
import { atomFeed } from "@/modules/scotus/domain/activity-feed";

export const dynamic = "force-dynamic";

const loadEmergency = unstable_cache(
  () => listEmergencyFeed(db()),
  ["scotus-emergency-feed"],
  { revalidate: 300 },
);

/** Live emergency applications only. Extensions of time are left out. No email is sent. */
export async function GET() {
  const origin = siteOrigin();
  const selfUrl = `${origin}/feeds/scotus/emergency`;
  const items = await loadEmergency();
  const body = atomFeed({
    id: selfUrl, title: "Jurvio Supreme Court emergency docket", selfUrl,
    subtitle: "Live emergency applications other than routine extensions of time. Historical emergency rows are not in this feed.",
    updated: items[0]?.updated ?? new Date().toISOString(), items,
  });
  return new Response(body, { headers: { "Content-Type": "application/atom+xml; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
