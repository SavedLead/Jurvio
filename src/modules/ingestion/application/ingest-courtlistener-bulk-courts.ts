import type postgres from "postgres";
import { createPublicId } from "@/lib/ids/public-id";
import {
  courtListenerBulkCourtSchema,
  openBulkCsv,
  parseBulkCsv,
} from "../providers/courtlistener/bulk";

type Sql = ReturnType<typeof postgres>;

export async function ingestCourtListenerBulkCourts(
  sql: Sql,
  filePath: string,
  snapshotDate: string,
) {
  const source = openBulkCsv(filePath);
  let processed = 0;

  try {
    const [provider] = await sql<{ id: string }[]>`
      SELECT id FROM provider WHERE code = 'courtlistener'
    `;
    if (!provider) throw new Error("CourtListener provider seed is missing");

    for await (const court of parseBulkCsv(source.stream, courtListenerBulkCourtSchema)) {
      await sql`
        INSERT INTO court (
          public_id, provider_id, provider_court_id, name, short_name,
          jurisdiction, source_url, verification
        ) VALUES (
          ${createPublicId("court")}, ${provider.id}, ${court.id},
          ${court.full_name}, ${court.short_name}, ${court.jurisdiction || null},
          ${court.url || null}, 'not_verified'
        )
        ON CONFLICT (provider_id, provider_court_id)
        DO UPDATE SET
          name = EXCLUDED.name,
          short_name = EXCLUDED.short_name,
          jurisdiction = EXCLUDED.jurisdiction,
          source_url = EXCLUDED.source_url,
          updated_at = now()
      `;
      processed += 1;
    }
    await source.completion;

    await sql`
      INSERT INTO ingestion_checkpoint (provider_id, stream_name, cursor_value)
      VALUES (${provider.id}, 'bulk:courts', ${snapshotDate})
      ON CONFLICT (provider_id, stream_name)
      DO UPDATE SET cursor_value = EXCLUDED.cursor_value, updated_at = now()
    `;
    return { processed, snapshotDate };
  } finally {
    source.close();
  }
}
