import { createHash } from "node:crypto";
import type postgres from "postgres";
import { fetchOfficialAppellateListing, type ListingFetch } from "../providers/appellate/official-opinions";
import type { AppellateCourtSource } from "../providers/appellate/registry";
import { errorText, httpStatusOf, recordCourtFetch } from "@/modules/operations/application/court-fetch-log";
import { recordSourceWatermark } from "@/modules/operations/application/court-freshness";

type Sql = ReturnType<typeof postgres>;

export async function discoverOfficialAppellateOpinions(sql: Sql, court: AppellateCourtSource) {
  const [prior] = await sql<{ listing_etag: string | null; listing_last_modified: string | null }[]>`
    SELECT listing_etag, listing_last_modified
    FROM appellate_source_registry
    WHERE court_code = ${court.code}
  `;
  const startedAtMs = Date.now();
  let listing: Awaited<ReturnType<typeof fetchOfficialAppellateListing>>;
  try {
    listing = await fetchOfficialAppellateListing(court, {
      etag: prior?.listing_etag,
      lastModified: prior?.listing_last_modified,
    });
  } catch (error) {
    // Before this, a 404 or timeout threw before the registry row was touched,
    // so ca6, ca11 and cadc stayed 'unknown' for months. Record it, then rethrow.
    const fetches = (error as { fetches?: ListingFetch[] }).fetches;
    if (fetches?.length) await logFetches(sql, court.code, fetches, 0);
    else await recordCourtFetch(sql, {
      source: "appellate_official", courtCode: court.code, url: court.opinionsUrl, startedAtMs,
      httpStatus: httpStatusOf(error), ok: false, error: errorText(error),
    });
    await recordSourceWatermark(sql, { source: "appellate_official", courtCode: court.code, ok: false, error: errorText(error) })
      .catch(() => undefined);
    await sql`
      UPDATE appellate_source_registry SET
        health_state = 'degraded',
        consecutive_failures = consecutive_failures + 1,
        next_poll_at = now() + LEAST(interval '60 minutes', interval '5 minutes' * power(2, LEAST(consecutive_failures, 4))),
        updated_at = now()
      WHERE court_code = ${court.code}
    `;
    throw error;
  }
  if (listing.notModified) {
    await sql`
      UPDATE appellate_source_registry SET
        last_successful_retrieval = ${listing.retrievedAt},
        listing_etag = COALESCE(${listing.etag}, listing_etag),
        listing_last_modified = COALESCE(${listing.lastModified}, listing_last_modified),
        health_state = 'healthy',
        consecutive_failures = 0,
        next_poll_at = now() + interval '5 minutes',
        updated_at = now()
      WHERE court_code = ${court.code}
    `;
    await recordCourtFetch(sql, {
      source: "appellate_official", courtCode: court.code, url: court.opinionsUrl, startedAtMs, httpStatus: 304, ok: true, items: null,
    });
    return { court: court.code, notModified: true, retrieved: 0, discovered: 0, seen: 0, costCents: 0 };
  }
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
        listing_etag = COALESCE(${listing.etag}, listing_etag),
        listing_last_modified = COALESCE(${listing.lastModified}, listing_last_modified),
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
  await logFetches(sql, court.code, listing.fetches, discovered);
  await recordSourceWatermark(sql, {
    source: "appellate_official", courtCode: court.code, ok: true, itemsFetched: listing.candidates.length, newEntries: discovered,
  }).catch(() => undefined);
  return { court: court.code, retrieved: listing.candidates.length, discovered, seen, costCents: 0 };
}

/** One court_fetch_log row per listing request; new items are credited to the first successful listing. */
async function logFetches(sql: Sql, courtCode: string, fetches: readonly ListingFetch[], discovered: number) {
  let credited = false;
  for (const fetch of fetches) {
    const newItems = fetch.ok && !credited ? discovered : fetch.ok ? 0 : null;
    if (fetch.ok) credited = true;
    await recordCourtFetch(sql, {
      source: "appellate_official", courtCode, url: fetch.url, startedAtMs: fetch.startedAtMs, httpStatus: fetch.httpStatus,
      ok: fetch.ok, bytes: fetch.bytes, items: fetch.ok ? fetch.items : null, newItems, error: fetch.error,
    });
  }
}
