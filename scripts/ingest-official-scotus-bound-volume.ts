import { closeDb, db } from "@/db/client";
import { ingestOfficialScotusBoundVolume } from "@/modules/ingestion/application/ingest-official-scotus-bound-volume";
import { LocalArtifactStore } from "@/modules/ingestion/infrastructure/local-artifact-store";

const args = new Map(process.argv.slice(2).map((value) => {
  const [key, raw = "true"] = value.replace(/^--/, "").split("=", 2);
  return [key, raw];
}));
const volume = Number.parseInt(args.get("volume") ?? "", 10);
const limit = Number.parseInt(args.get("limit") ?? "100", 10);
const resume = args.get("resume") !== "false";
const artifactRoot = process.env.RAW_ARTIFACT_DIR ?? process.env.JURVIO_ARTIFACT_ROOT ?? ".data/artifacts";
try {
  console.log(JSON.stringify(await ingestOfficialScotusBoundVolume(db(), new LocalArtifactStore(artifactRoot), {
    volume, limit, resume,
  })));
} finally {
  await closeDb();
}
