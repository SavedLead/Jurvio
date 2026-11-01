import postgres from "postgres";
import { env } from "@/lib/config/env";
import { runAlertDigests } from "@/modules/accounts/application/alerts";
import { getEmailProvider } from "@/modules/accounts/infrastructure/email";

// Followed-case docket alert digests (scheduler job "account-alerts", every 10 min).
// No-op unless RESEND_API_KEY, EMAIL_FROM and EMAIL_POSTAL_ADDRESS are set.
//   node jobs/run-account-alerts.mjs [--max-users=500]
const args = new Map(process.argv.slice(2).map((value) => {
  const [key, raw = "true"] = value.replace(/^--/, "").split("=", 2);
  return [key, raw] as const;
}));
const maxUsers = Number.parseInt(args.get("max-users") ?? "", 10);

const sql = postgres(env().DATABASE_URL, {
  max: 1,
  connection: { application_name: "jurvio-account-alerts", statement_timeout: 60_000 },
});
try {
  const [lock] = await sql<{ ok: boolean }[]>`SELECT pg_try_advisory_lock(hashtext('jurvio-account-alerts-v1')) AS ok`;
  if (!lock?.ok) {
    console.log(JSON.stringify({ accountAlerts: "skipped", reason: "previous run still active" }));
  } else {
    const started = Date.now();
    const summary = await runAlertDigests(sql, {
      provider: getEmailProvider(),
      siteUrl: env().SITE_URL,
      postalAddress: process.env.EMAIL_POSTAL_ADDRESS,
      maxUsers: Number.isFinite(maxUsers) && maxUsers > 0 ? maxUsers : 500,
    });
    console.log(JSON.stringify({ accountAlerts: summary.status, elapsedMs: Date.now() - started, ...summary }));
  }
} finally {
  await sql.end();
}
