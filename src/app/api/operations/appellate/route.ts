import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireInternalPrincipal } from "@/modules/identity/cloudflare-access";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sql = db();
    await requireInternalPrincipal(
      sql, await headers(), ["viewer", "reviewer", "administrator"],
    );
    const checkpoints = await sql<{
      court_code: string;
      status: string;
      pages_processed: string;
      records_discovered: string;
      records_enqueued: string;
      records_skipped: string;
      last_successful_retrieval: string | null;
      consecutive_failures: number;
    }[]>`
      SELECT court_code, status, pages_processed::text, records_discovered::text,
        records_enqueued::text, records_skipped::text,
        last_successful_retrieval::text, consecutive_failures
      FROM govinfo_appellate_checkpoint
      ORDER BY court_code
    `;

    const queue = await sql<{
      state: string;
      count: string;
      oldest_decided_on: string | null;
      latest_seen_at: string;
    }[]>`
      SELECT state, count(*)::text, min(decided_on)::text AS oldest_decided_on,
        max(last_seen_at)::text AS latest_seen_at
      FROM appellate_ingestion_item
      WHERE document_url LIKE 'https://www.govinfo.gov/content/pkg/%'
      GROUP BY state
      ORDER BY state
    `;

    const [latest] = await sql<{
      court_code: string;
      public_id: string | null;
      last_seen_at: string;
      decided_on: string | null;
    }[]>`
      SELECT item.court_code, legal_case.public_id,
        item.last_seen_at::text, item.decided_on::text
      FROM appellate_ingestion_item item
      LEFT JOIN legal_case ON legal_case.id=item.published_case_id
      WHERE item.document_url LIKE 'https://www.govinfo.gov/content/pkg/%'
        AND item.state='published'
      ORDER BY item.last_seen_at DESC
      LIMIT 1
    `;

    return NextResponse.json({
      status: "ok",
      checkedAt: new Date().toISOString(),
      govInfo: { checkpoints, queue, latestPublishedRecord: latest ?? null },
    });
  } catch {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }
}
