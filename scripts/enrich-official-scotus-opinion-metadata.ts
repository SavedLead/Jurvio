import { closeDb, db } from "@/db/client";
import { enrichOfficialScotusOpinionMetadata } from "@/modules/ingestion/application/enrich-official-scotus-opinion-metadata";

const args = new Map(process.argv.slice(2).map((value) => {
  const [key, raw = "true"] = value.replace(/^--/, "").split("=", 2);
  return [key, raw];
}));
const limit = Number.parseInt(args.get("limit") ?? "100", 10);
try {
  console.log(JSON.stringify(await enrichOfficialScotusOpinionMetadata(db(), { limit })));
} finally {
  await closeDb();
}
