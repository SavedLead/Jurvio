import { closeDb, db } from "@/db/client";
import { ingestCourtListenerDocket } from "@/modules/ingestion/application/ingest-courtlistener-docket";
import { LocalArtifactStore } from "@/modules/ingestion/infrastructure/local-artifact-store";
import { fetchModifiedDockets } from "@/modules/ingestion/providers/courtlistener/client";

interface Options {
  since: string;
  maximumCases: number;
  cursor?: string;
}

function valueAfter(flag: string) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseOptions(): Options {
  const since = valueAfter("--since");
  const maximumCases = Number(valueAfter("--max-cases") ?? "5");
  const cursor = valueAfter("--cursor");

  if (!since || Number.isNaN(Date.parse(since))) {
    throw new Error(
      "Usage: pnpm ingest:updates -- --since <ISO timestamp> [--max-cases 1..50] [--cursor URL]",
    );
  }
  if (!Number.isInteger(maximumCases) || maximumCases < 1 || maximumCases > 50) {
    throw new Error("--max-cases must be an integer between 1 and 50");
  }
  if (cursor) {
    const parsed = new URL(cursor);
    if (parsed.protocol !== "https:" || parsed.hostname !== "www.courtlistener.com") {
      throw new Error("--cursor must be an HTTPS CourtListener URL");
    }
  }
  return { since: new Date(since).toISOString(), maximumCases, cursor };
}

const options = parseOptions();
const sql = db();
const artifactStore = new LocalArtifactStore(process.env.RAW_ARTIFACT_DIR ?? ".data/raw");
let runId: string | undefined;
let seen = 0;
let changed = 0;

try {
  const [provider] = await sql<{ id: string }[]>`
    SELECT id FROM provider WHERE code = 'courtlistener'
  `;
  if (!provider) throw new Error("CourtListener provider seed is missing");

  const [run] = await sql<{ id: string }[]>`
    INSERT INTO ingestion_run (provider_id, cursor_value, status)
    VALUES (${provider.id}, ${options.cursor ?? options.since}, 'running')
    RETURNING id
  `;
  if (!run) throw new Error("Ingestion run was not created");
  runId = run.id;

  let cursor = options.cursor;
  while (seen < options.maximumCases) {
    const page = await fetchModifiedDockets(options.since, cursor);
    const candidates = page.records.slice(0, options.maximumCases - seen);
    if (candidates.length === 0) {
      cursor = page.next ?? undefined;
      break;
    }

    for (const candidate of candidates) {
      seen += 1;
      await ingestCourtListenerDocket(sql, artifactStore, candidate.record.id);
      changed += 1;
      process.stdout.write(
        `${JSON.stringify({ event: "case_ingested", docketId: candidate.record.id, seen, changed })}\n`,
      );
    }

    cursor = page.next ?? undefined;
    await sql`
      UPDATE ingestion_run
      SET cursor_value = ${cursor ?? null}, records_seen = ${seen}, records_changed = ${changed}
      WHERE id = ${runId}
    `;
    if (!cursor || candidates.length < page.records.length) break;
  }

  await sql`
    UPDATE ingestion_run
    SET status = 'completed', completed_at = now(), cursor_value = ${cursor ?? null},
      records_seen = ${seen}, records_changed = ${changed}
    WHERE id = ${runId}
  `;
  process.stdout.write(
    `${JSON.stringify({ event: "ingestion_completed", runId, seen, changed, nextCursor: cursor ?? null })}\n`,
  );
} catch (error) {
  if (runId) {
    const failure = error instanceof Error ? { message: error.message, name: error.name } : { message: String(error) };
    await sql`
      UPDATE ingestion_run
      SET status = 'failed', completed_at = now(), records_seen = ${seen},
        records_changed = ${changed}, error = ${sql.json(failure)}
      WHERE id = ${runId}
    `;
  }
  throw error;
} finally {
  await closeDb();
}
