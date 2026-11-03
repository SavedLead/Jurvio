import { writeFileSync } from "node:fs";
import { entityAlertsDryRunSql } from "@/modules/accounts/application/entity-alerts-report";

// Regenerates scripts/diag/entity-alerts-dry-run.sql:
//   pnpm exec tsx scripts/print-entity-alerts-dry-run.ts
writeFileSync("scripts/diag/entity-alerts-dry-run.sql", entityAlertsDryRunSql());
