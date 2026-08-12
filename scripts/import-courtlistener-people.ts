import { closeDb, db } from "../src/db/client";
import { importCourtListenerPeople } from "../src/modules/judges/application/import-courtlistener-people";

importCourtListenerPeople(db())
  .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
  .finally(closeDb);
