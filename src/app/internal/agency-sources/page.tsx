import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { requireInternalPrincipal } from "@/modules/identity/cloudflare-access";
import { getAgencySourceHealth, listReviewQueue } from "@/modules/agency-sources/application/health";

/**
 * Agency sources: per-source health (last run, status, items, links, queue) and the
 * review queue of items whose stated court + docket did not link to exactly one case.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Agency sources", robots: { index: false, follow: false } };

const time = (value: string | null) => (value ? new Date(value).toLocaleString("en-US", { timeZone: "America/New_York" }) + " ET" : "never");

export default async function AgencySourcesPage() {
  try {
    await requireInternalPrincipal(db(), await headers(), ["viewer", "reviewer", "administrator"]);
  } catch {
    notFound();
  }
  const [health, queue] = await Promise.all([getAgencySourceHealth(db()), listReviewQueue(db(), 150)]);
  return <main style={{ padding: 24 }}>
    <h1>Agency sources</h1>
    <p>Items link to a case only when they state its court and docket number and exactly one Jurvio case matches. Everything else is listed below for review. Restricted (sealed) items are never shown publicly.</p>
    <table>
      <thead><tr><th>Source</th><th>Status</th><th>Last success</th><th>Items</th><th>24 h</th><th>Linked</th><th>Queued</th><th>Restricted</th><th>Last error</th></tr></thead>
      <tbody>{health.map((row) => <tr key={row.code}>
        <td title={row.name}>{row.code}{row.enabled ? "" : " (not polled)"}</td>
        <td>{row.lastStatus ?? "—"}{row.consecutiveFailures > 1 ? ` ×${row.consecutiveFailures}` : ""}</td>
        <td>{time(row.lastSuccessAt)}</td><td>{row.items}</td><td>{row.items24h}</td><td>{row.linked}</td><td>{row.queued}</td><td>{row.restricted}</td>
        <td style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis" }}>{row.lastError ?? ""}</td>
      </tr>)}</tbody>
    </table>
    <h2>Review queue ({queue.length})</h2>
    <table>
      <thead><tr><th>Source</th><th>Item</th><th>Stated references</th></tr></thead>
      <tbody>{queue.map((item) => <tr key={item.sourceUrl}>
        <td>{item.sourceCode}</td>
        <td><a href={item.sourceUrl} rel="noopener noreferrer">{item.title}</a>{item.restricted ? ` — restricted: ${item.restrictedReason}` : ""}</td>
        <td>{item.refs.map((ref) => `${ref.court ?? "court not stated"} ${ref.docket}: ${ref.status}${ref.note ? ` (${ref.note})` : ""}`).join("; ")}</td>
      </tr>)}</tbody>
    </table>
  </main>;
}
