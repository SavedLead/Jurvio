import { closeDb, db } from "@/db/client";
import { ingestOfficialScotusOpinions } from "@/modules/ingestion/application/ingest-official-scotus-opinions";
import { LocalArtifactStore } from "@/modules/ingestion/infrastructure/local-artifact-store";

const args = new Map(process.argv.slice(2).map((value) => {
  const [key, raw = "true"] = value.replace(/^--/, "").split("=", 2);
  return [key, raw];
}));
const termYear = args.get("term") ?? "";
const limit = Number.parseInt(args.get("limit") ?? "25", 10);
const resume = args.get("resume") === "true";
if (!termYear) throw new Error("Usage: pnpm ingest:scotus:official --term=24 [--limit=25] [--resume=true]");

const artifactRoot = process.env.JURVIO_ARTIFACT_ROOT
  ?? process.env.RAW_ARTIFACT_DIR
  ?? ".data/artifacts";

try {
  const result = await ingestOfficialScotusOpinions(
    db(),
    new LocalArtifactStore(artifactRoot),
    { termYear, limit, resume },
  );
  console.log(JSON.stringify(result));
} finally { await closeDb(); }
