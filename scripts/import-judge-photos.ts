import { closeDb, db } from "../src/db/client";
import { importJudgePhotos } from "../src/modules/judges/application/import-judge-photos";

importJudgePhotos(db())
  .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
  .finally(closeDb);
