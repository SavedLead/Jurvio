/**
 * Read the public Supreme Court slip-opinion, orders, and relating-to-orders
 * indexes and print a coverage report. No database. No PDF downloads.
 *
 *   pnpm exec tsx scripts/diagnose-scotus-coverage.ts --term=26
 */
import { fetchOfficialSlipOpinionIndex } from "@/modules/ingestion/providers/scotus/official-opinions";
import { fetchOfficialOrdersIndex, parseRelatingToOrdersIndex } from "@/modules/ingestion/providers/scotus/official-orders";
import { buildScotusCoverageReport } from "@/modules/scotus/domain/coverage-report";

const term = process.argv.find((arg) => arg.startsWith("--term="))?.slice("--term=".length) ?? "26";
if (!/^\d{2}$/.test(term)) throw new Error("--term must be a two-digit year");

const orders = await fetchOfficialOrdersIndex(term);
const slip = await fetchOfficialSlipOpinionIndex(term);
const relatingUrl = `https://www.supremecourt.gov/opinions/relatingtoorders/${term}`;
const relatingResponse = await fetch(relatingUrl, {
  headers: { "user-agent": process.env.INGESTION_USER_AGENT ?? "Jurvio/0.1" },
  redirect: "error",
});
if (!relatingResponse.ok) throw new Error(`Relating-to-orders index returned HTTP ${relatingResponse.status}`);
const relatingHtml = await relatingResponse.text();
const report = buildScotusCoverageReport({
  retrievedAt: new Date().toISOString(),
  slipOpinions: slip.records.map((row) => ({
    termYear: term,
    filedOn: row.filedOn,
    docketNumber: row.docketNumber,
    caseName: row.caseName,
    sourceUrl: row.pdfUrl,
  })),
  orders: orders.entries,
  relating: parseRelatingToOrdersIndex(relatingHtml, term),
});
console.log(JSON.stringify({
  ordersIndex: { sourceUri: orders.sourceUri, retrievedAt: orders.retrievedAt, contentHash: orders.contentHash },
  slipIndex: { sourceUri: slip.sourceUri, retrievedAt: slip.retrievedAt, contentHash: slip.contentHash },
  relatingUrl,
  report,
}, null, 2));
