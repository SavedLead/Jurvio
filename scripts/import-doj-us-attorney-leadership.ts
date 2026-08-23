import { closeDb, db } from "../src/db/client";
import { importDojUsAttorneyLeadership } from "../src/modules/usao/application/import-doj-us-attorney-leadership";

importDojUsAttorneyLeadership(db())
  .then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.unmatched.length) process.exitCode = 2;
  })
  .finally(closeDb);
