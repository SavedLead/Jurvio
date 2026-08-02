import { closeDb, db } from "@/db/client";

const sql = db();

try {
  const checkpoints = await sql<{
    court_code: string; status: string; pages_processed: string;
    records_discovered: string; records_enqueued: string; records_skipped: string;
    last_successful_retrieval: string | null; last_error: string | null;
  }[]>\`
    SELECT court_code, status, pages_processed::text, records_discovered::text,
      records_enqueued::text, records_skipped::text,
      last_successful_retrieval::text, last_error
    FROM govinfo_appellate_checkpoint
    ORDER BY court_code
  \`;

  const funnel = await sql<{
    court_code: string; state: string; count: string;
    last_seen_at: string; oldest_decided_on: string | null;
  }[]>\`
    SELECT court_code, state, count(*)::text,
      max(last_seen_at)::text AS last_seen_at,
      min(decided_on)::text AS oldest_decided_on
    FROM appellate_ingestion_item
    WHERE document_url LIKE 'https://www.govinfo.gov/content/pkg/%'
    GROUP BY court_code, state
    ORDER BY court_code, state
  \`;

  const latestPublished = await sql<{
    court_code: string; docket_number: string | null; caption: string;
    decided_on: string | null; published_at: string; public_id: string | null;
  }[]>\`
    SELECT item.court_code, item.docket_number, item.caption,
      item.decided_on::text, item.last_seen_at::text AS published_at,
      legal_case.public_id
    FROM appellate_ingestion_item item
    LEFT JOIN legal_case ON legal_case.id=item.published_case_id
    WHERE item.document_url LIKE 'https://www.govinfo.gov/content/pkg/%'
      AND item.state='published'
    ORDER BY item.last_seen_at DESC
    LIMIT 20
  \`;

  const byCourt = checkpoints.map((checkpoint) => ({
    ...checkpoint,
    queue: funnel.filter((row) => row.court_code === checkpoint.court_code),
  }));
  console.log(JSON.stringify({
    lane: "appellate-backfill-report",
    checkedAt: new Date().toISOString(),
    checkpoints: byCourt,
    latestGovInfoPublications: latestPublished,
  }));
} finally {
  await closeDb();
}
