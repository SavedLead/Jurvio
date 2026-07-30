import { createHash } from "node:crypto";
import type postgres from "postgres";
import { fetchOfficialAppellateListing } from "../providers/appellate/official-opinions";
import type { AppellateCourtSource } from "../providers/appellate/registry";

type Sql = ReturnType<typeof postgres>;

export async function discoverOfficialAppellateOpinions(sql: Sql, court: AppellateCourtSource) {
  const listing = await fetchOfficialAppellateListing(court);
  const checkpoint = createHash("sha256").update(listing.body).digest("hex");
  let discovered = 0;
  let seen = 0;
  try {
    for (const item of listing.candidates) {
      const rows = await sql<{ was_new: boolean }[]>`
        INSERT INTO appellate_ingestion_item (
          court_code, docket_number, caption, decided_on, document_url, source_listing_url
        ) VALUES (
          ${item.courtCode}, ${item.docketNumber}, ${item.caption}, ${item.decidedOn},
          ${item.documentUrl}, ${item.sourceListingUrl}
        )
        ON CONFLICT (court_code, document_url) DO UPDATE SET
          last_seen_at = now(),
          docket_number = COALESCE(appellate_ingestion_item.docket_number, EXCLUDED.docket_number),
          decided_on = COALESCE(appellate_ingestion_item.decided_on, EXCLUDED.decided_on),
          caption = CASE
            WHEN length(EXCLUDED.caption) > length(appellate_ingestion_item.caption)
            THEN EXCLUDED.caption ELSE appellate_ingestion_item.caption END
        RETURNING (xmax = 0) AS was_new
      `;
      if (rows[0]?.was_new) discovered += 1;
      else seen += 1;
    }
    await sql`
      UPDATE appellate_source_registry SET
        checkpoint = ${checkpoint},
        last_successful_retrieval = ${listing.retrievedAt},
        health_state = 'healthy',
        consecutive_failures = 0,
        next_poll_at = now() + interval '5 minutes',
        updated_at = now()
      WHERE court_code = ${court.code}
    `;
  } catch (error) {
    await sql`
      UPDATE appellate_source_registry SET
        health_state = 'degraded',
        consecutive_failures = consecutive_failures + 1,
        next_poll_at = now() + LEAST(
          interval '10 minutes',
          interval '5 minutes' * power(2, LEAST(consecutive_failures, 1))
        ),
        updated_at = now()
      WHERE court_code = ${court.code}
    `;
    throw error;
  }
  return { court: court.code, retrieved: listing.candidates.length, discovered, seen, costCents: 0 };
}
