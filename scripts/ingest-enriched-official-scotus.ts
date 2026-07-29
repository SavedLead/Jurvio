import { closeDb, db } from "@/db/client";
import { ingestOfficialScotusOpinions } from "@/modules/ingestion/application/ingest-official-scotus-opinions";
import { ingestOfficialScotusDockets } from "@/modules/ingestion/application/ingest-official-scotus-dockets";
import { LocalArtifactStore } from "@/modules/ingestion/infrastructure/local-artifact-store";
import { publishVerifiedOfficialScotusOpinions } from "@/modules/publication/application/publish-official-scotus-opinions";

const args = new Map(process.argv.slice(2).map((value) => {
  const [key, raw = "true"] = value.replace(/^--/, "").split("=", 2);
  return [key, raw];
}));
const termYear = args.get("term") ?? "";
const limit = Number.parseInt(args.get("limit") ?? "100", 10);
const resume = args.get("resume") === "true";
const attempts = Number.parseInt(args.get("attempts") ?? "10", 10);
if (!termYear) throw new Error("Usage: --term=25 [--limit=100] [--resume=true] [--attempts=10]");
if (!Number.isInteger(attempts) || attempts < 1 || attempts > 20) {
  throw new Error("Attempts must be between 1 and 20");
}

const artifactRoot = process.env.JURVIO_ARTIFACT_ROOT
  ?? process.env.RAW_ARTIFACT_DIR
  ?? ".data/artifacts";
const sql = db();
const artifactStore = new LocalArtifactStore(artifactRoot);

try {
  const ingestion = await ingestOfficialScotusOpinions(
    sql,
    artifactStore,
    { termYear, limit, resume },
  );
  const docketRuns = [];
  const publicationRuns = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const docket = await ingestOfficialScotusDockets(sql, artifactStore, { limit });
    docketRuns.push(docket);
    const publication = await publishVerifiedOfficialScotusOpinions(sql, { limit });
    publicationRuns.push(publication);
    if (docket.selected === 0 && publication.selected === 0) break;
  }
  console.log(JSON.stringify({
    mode: "ingest_enrich_publish",
    ingestion,
    dockets: docketRuns,
    publications: publicationRuns,
  }));
} finally {
  await closeDb();
}
