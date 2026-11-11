// One-off: send the owner "new sign-up" email for accounts that existed before
// the notifier shipped. Input is a JSON array (one object per account, already
// CLAIMED by setting app_user.signup_notified_at, so a re-run cannot resend).
// Prints only counts and domains, never addresses.
// Usage: tsx scripts/notify-existing-signups.ts <rows.json> [--dry-run]
import { readFileSync } from "node:fs";
import { signupDetailsFromRow, signupNotificationEmail, signupNotifyRecipient, type SignupNotifyRow } from "../src/modules/accounts/application/signup-notify";
import { getEmailProvider } from "../src/modules/accounts/infrastructure/email";

async function main() {
  const [file, flag] = process.argv.slice(2);
  const rows = JSON.parse(readFileSync(file!, "utf8") || "[]") as SignupNotifyRow[];
  const domains = (list: SignupNotifyRow[]) => [...new Set(list.map((r) => r.email.slice(r.email.lastIndexOf("@") + 1)))].join(",") || "-";
  if (flag === "--dry-run") { console.log(`dry-run accounts=${rows.length} domains=${domains(rows)}`); return; }
  const to = signupNotifyRecipient();
  const provider = getEmailProvider();
  if (!to || !provider) throw new Error("email provider or recipient not configured");
  let sent = 0; const failed: SignupNotifyRow[] = [];
  for (const r of rows) {
    const message = signupNotificationEmail(signupDetailsFromRow(r));
    const result = await provider.send({ to, ...message, tag: "signup_notify", headers: { "X-Entity-Ref-ID": `signup-${r.id}` } });
    if (result.ok) sent++; else { failed.push(r); console.error(`send failed (${result.error})`); }
  }
  console.log(`sent=${sent} failed=${failed.length} domains=${domains(rows)}${failed.length ? ` failed_domains=${domains(failed)}` : ""}`);
  if (failed.length) process.exitCode = 1;
}

if (process.argv[1]?.endsWith("notify-existing-signups.ts")) void main();
