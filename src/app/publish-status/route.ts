import { db } from "@/db/client";
import { listPublisherCycles } from "@/modules/publication/application/list-publisher-cycles";

export const dynamic = "force-dynamic";

/** Aggregate publisher cycles. No captions, docket numbers, or addresses. */
export async function GET() {
  const cycles = await listPublisherCycles(db()).catch(() => []);
  return Response.json(
    { checkedAt: new Date().toISOString(), cycles },
    { headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow, noarchive" } },
  );
}
