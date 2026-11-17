import { db } from "@/db/client";
import { serveAtomFeed } from "@/lib/http/serve-atom-feed";
import { districtFeedXml } from "@/modules/ingestion/application/live-feed-health";

export const dynamic = "force-dynamic";

export function GET() {
  return serveAtomFeed("district", () => districtFeedXml(db()));
}
