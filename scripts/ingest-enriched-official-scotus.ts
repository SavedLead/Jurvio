import { closeDb, db } from "@/db/client";
import { ingestOfficialScotusOpinions } from "@/modules/ingestion/application/ingest-official-scotus-opinions";
import { ingestOfficialScotusDockets } from "@/modules/ingestion/application/ingest-official-scotus-dockets";
import { enrichOfficialScotusOpinionMetadata } from "@/modules/ingestion/application/enrich-official-scotus-opinion-metadata";
import { LocalArtifactStore } from "@/modules/ingestion/infrastructure/local-artifact-store";
import { publishVerifiedOfficialScotusOpinions } from "@/modules/publication/application/publish-official-scotus-opinions";
import { extractOfficialScotusOpinionText } from "@/modules/publication/application/extract-official-scotus-opinion-text";

const args = new Map(process.argv.slice(2).map((value) => {
  const [key, raw = "true"] = value.replace(/^--/, "").split("=", 2);
  return [key, raw];
}));
const termYear = args.get("term") ?? "";
const requestedLimit = Number.parseInt(args.get("limit") ?? "100", 10);
const resume = args.get("resume") === "true";
const attempts = Number.parseInt(args.get("attempts") ?? "10", 10);
if (!termYear) throw new Error("Usage: --term=25 [--limit=100] [--resume=true] [--attempts=10]");
if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
  throw new Error("--limit must be a positive integer");
}
if (!Number.isInteger(attempts) || attempts < 1 || attempts > 20) {
  throw new Error("Attempts must be between 1 and 20");
}

// Each stage enforces its own batch ceiling, so a single `--limit` lane budget is
// fanned out to each stage's real ceiling rather than passed through blindly.
//
// The slip-opinion fetch, metadata enrichment, and docket enrichment are all
// network-bound against supremecourt.gov and hard-cap at 100 per call; publication
// and text extraction are pure DB work and drain far larger batches. Forwarding the
// raw `--limit` (e.g. the scheduler's 300) straight into a 1–100 stage previously
// threw "Batch limit must be between 1 and 100" synchronously, crashing the whole
// lane on startup with exit code 1 before any work ran. Clamping per stage keeps the
// lane resilient to an over-large budget while still letting the DB-drain stages use
// the full amount.
const FETCH_BATCH_CEILING = 100;
const DRAIN_BATCH_CEILING = 100_000;
const fetchLimit = Math.min(requestedLimit, FETCH_BATCH_CEILING);
const drainLimit = Math.min(requestedLimit, DRAIN_BATCH_CEILING);

const artifactRoot = process.env.JURVIO_ARTIFACT_ROOT
  ?? process.env.RAW_ARTIFACT_DIR
  ?? ".data/artifacts";
const sql = db();
const artifactStore = new LocalArtifactStore(artifactRoot);

try {
  const ingestion = await ingestOfficialScotusOpinions(
    sql,
    artifactStore,
    { termYear, limit: fetchLimit, resume },
  );
  const opinionRuns = [];
  const docketRuns = [];
  const publicationRuns = [];
  const extractionRuns = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const opinion = await enrichOfficialScotusOpinionMetadata(sql, { limit: fetchLimit });
    opinionRuns.push(opinion);
    const docket = await ingestOfficialScotusDockets(sql, artifactStore, { limit: fetchLimit });
    docketRuns.push(docket);
    const publication = await publishVerifiedOfficialScotusOpinions(sql, { limit: drainLimit });
    publicationRuns.push(publication);
    const extraction = await extractOfficialScotusOpinionText(sql, { limit: drainLimit, artifactRoot });
    extractionRuns.push(extraction);
    if (opinion.selected === 0 && docket.selected === 0
      && publication.selected === 0 && extraction.selected === 0) break;
  }
  console.log(JSON.stringify({
    mode: "ingest_enrich_publish",
    ingestion,
    opinions: opinionRuns,
    dockets: docketRuns,
    publications: publicationRuns,
    extractions: extractionRuns,
  }));
} finally {
  await closeDb();
}
