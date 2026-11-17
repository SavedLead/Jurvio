import { db } from "@/db/client";
import { serveAtomFeed } from "@/lib/http/serve-atom-feed";
import { appealsFeedXml } from "@/modules/ingestion/application/live-feed-health";

export const dynamic = "force-dynamic";

export function GET() {
  return serveAtomFeed("appeals", () => appealsFeedXml(db()));
}
