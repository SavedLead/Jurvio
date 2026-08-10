/**
 * Read-only verification that an immutable DigitalOcean Spaces artifact traces,
 * by content hash, to its normalized and eligible (published) record.
 *
 * It walks the most recently retrieved raw artifacts that back a PUBLISHED
 * legal_case, HEADs each object in Spaces, and reports the first that is present
 * — confirming that:
 *   raw_artifact.object_key exists in Spaces
 *   AND the object's stored `x-amz-meta-content-hash` == raw_artifact.content_hash
 *   AND raw_artifact.id == legal_case.source_artifact_id (publication='published').
 *
 * Writes nothing. Prints one JSON document to stdout. Exits non-zero only on an
 * unexpected error; a "not yet traceable" outcome exits 0 with verified=false so
 * an operator workflow shows the factual state instead of failing.
 *
 * Optional arg: --since=<ISO> to only consider artifacts retrieved at/after a
 * cutoff (e.g. the moment Spaces was activated). Default: no cutoff — existence
 * in Spaces is itself proof the object was written under the Spaces backend.
 */
import { closeDb, db } from "@/db/client";
import {
  createSpacesArtifactStore,
  spacesConfigured,
} from "@/modules/ingestion/infrastructure/create-artifact-store";

const sinceArg = process.argv.find((a) => a.startsWith("--since="))?.split("=")[1] ?? null;
const scanLimit = Number(
  process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? "100",
);

type Candidate = {
  artifact_id: string;
  content_hash: string;
  object_key: string;
  retrieved_at: string;
  source_uri: string;
  media_type: string;
  provider_code: string;
  case_public_id: string;
  caption: string;
  publication: string;
  court_public_id: string;
  court_name: string;
};

async function main() {
  const store = createSpacesArtifactStore(process.env);
  if (!spacesConfigured(process.env) || !store) {
    console.log(
      JSON.stringify(
        {
          verified: false,
          spacesConfigured: false,
          blocker:
            "JURVIO_SPACES_ACCESS_KEY_ID / JURVIO_SPACES_SECRET_ACCESS_KEY are not set; artifacts are on the local volume.",
        },
        null,
        2,
      ),
    );
    return;
  }

  const sql = db();
  const candidates = await sql<Candidate[]>`
    SELECT
      ra.id::text          AS artifact_id,
      ra.content_hash      AS content_hash,
      ra.object_key        AS object_key,
      ra.retrieved_at::text AS retrieved_at,
      ra.source_uri        AS source_uri,
      ra.media_type        AS media_type,
      p.code               AS provider_code,
      lc.public_id         AS case_public_id,
      lc.caption           AS caption,
      lc.publication::text AS publication,
      c.public_id          AS court_public_id,
      c.name               AS court_name
    FROM raw_artifact ra
    JOIN legal_case lc ON lc.source_artifact_id = ra.id
    JOIN court c ON c.id = lc.court_id
    JOIN provider p ON p.id = ra.provider_id
    WHERE lc.publication = 'published'
      AND (${sinceArg}::timestamptz IS NULL OR ra.retrieved_at >= ${sinceArg}::timestamptz)
    ORDER BY ra.retrieved_at DESC
    LIMIT ${Number.isFinite(scanLimit) ? scanLimit : 100}
  `;

  let scanned = 0;
  let presentButMismatched = 0;
  for (const c of candidates) {
    scanned += 1;
    const head = await store.head(c.object_key);
    if (!head.exists) continue;
    const hashMatches = head.contentHash === c.content_hash;
    if (!hashMatches) {
      presentButMismatched += 1;
      continue;
    }
    // Found an immutable Spaces object that traces by content hash to a
    // published record. This is the proof.
    console.log(
      JSON.stringify(
        {
          verified: true,
          spacesConfigured: true,
          scannedBeforeMatch: scanned,
          artifact: {
            id: c.artifact_id,
            provider: c.provider_code,
            contentHash: c.content_hash,
            objectKey: c.object_key,
            retrievedAt: c.retrieved_at,
            sourceUri: c.source_uri,
            mediaType: c.media_type,
          },
          spaces: {
            exists: true,
            status: head.status,
            storedContentHash: head.contentHash,
            hashMatches: true,
          },
          publishedRecord: {
            casePublicId: c.case_public_id,
            caption: c.caption,
            publication: c.publication,
            court: c.court_name,
            courtPublicId: c.court_public_id,
          },
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(
    JSON.stringify(
      {
        verified: false,
        spacesConfigured: true,
        scanned,
        presentButMismatched,
        note:
          candidates.length === 0
            ? "No published legal_case is linked to a raw_artifact yet."
            : "None of the scanned published-record artifacts are present in Spaces yet. New artifacts are written to Spaces going forward; re-run after the next direct-court ingestion cycle (or pass --since with the Spaces activation time).",
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
