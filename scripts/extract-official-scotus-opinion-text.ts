import { closeDb, db } from "@/db/client";
import { extractOfficialScotusOpinionText } from "@/modules/publication/application/extract-official-scotus-opinion-text";

const args = new Map(process.argv.slice(2).map((value) => {
  const [key, raw = "true"] = value.replace(/^--/, "").split("=", 2);
  return [key, raw];
}));
const limit = Number.parseInt(args.get("limit") ?? "100", 10);
const artifactRoot = process.env.JURVIO_ARTIFACT_ROOT ?? process.env.RAW_ARTIFACT_DIR ?? ".data/artifacts";

try {
  console.log(JSON.stringify(await extractOfficialScotusOpinionText(db(), { limit, artifactRoot })));
} finally {
  await closeDb();
}
