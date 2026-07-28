import { closeDb, db } from "@/db/client";
import { publishVerifiedOfficialScotusOpinions } from "@/modules/publication/application/publish-official-scotus-opinions";

const args = new Map(process.argv.slice(2).map((value) => {
  const [key, raw = "true"] = value.replace(/^--/, "").split("=", 2);
  return [key, raw];
}));
const limit = Number.parseInt(args.get("limit") ?? "100", 10);

try {
  const result = await publishVerifiedOfficialScotusOpinions(db(), { limit });
  console.log(JSON.stringify(result));
} finally {
  await closeDb();
}
