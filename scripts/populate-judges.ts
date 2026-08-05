import { closeDb, db } from "../src/db/client";
import { populateJudgesFromOpinions } from "../src/modules/judges/application/populate-judges";

const limitArg = process.argv.find((value) => value.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : 5_000;
if (!Number.isInteger(limit) || limit < 1 || limit > 50_000) {
  throw new Error("--limit must be an integer from 1 to 50000");
}

populateJudgesFromOpinions(db(), { limit })
  .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
  .finally(closeDb);
