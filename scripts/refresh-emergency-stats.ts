import postgres from "postgres";
import { refreshEmergencyStats } from "@/modules/scotus/application/emergency-stats";

// Rebuild the emergency docket analytics counts now (normally the scotus-emergency
// job does this after its run). Local / operator use:
//   DATABASE_URL=... tsx scripts/refresh-emergency-stats.ts
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const sql = postgres(url, { max: 1 });
try {
  console.log(JSON.stringify(await refreshEmergencyStats(sql, { force: true })));
} finally {
  await sql.end();
}
