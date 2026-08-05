import { closeDb, db } from "../src/db/client";
import { runDeterministicCaseIntelligence } from "../src/modules/case-intelligence/application/run-deterministic";

const limitArg = process.argv.find((value) => value.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : 500;

runDeterministicCaseIntelligence(db(), { limit })
  .then((result) => console.log(JSON.stringify(result)))
  .finally(closeDb);
