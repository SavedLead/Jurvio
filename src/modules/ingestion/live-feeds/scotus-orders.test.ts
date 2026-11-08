import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { OrdersRuntime } from "./scotus-orders";
import { runScotusOrders } from "./scotus-orders";
import type { OrdersWatchPlan, StoredOrdersEntryRef, StoredOrdersList } from "@/modules/scotus/domain/orders-list";

const fixture = (name: string) => readFileSync(join(__dirname, "../../scotus/fixtures/orders", name), "utf8");
const LIST = "https://www.supremecourt.gov/orders/courtorders/060826zor_21p3.pdf";
const OLDER = "https://www.supremecourt.gov/orders/courtorders/060126zor_k53l.pdf";
const MISC = "https://www.supremecourt.gov/orders/courtorders/060126zr_onjq.pdf";

describe("orders monitor runtime", () => {
  it("fetches order-list PDFs only, suppresses history, and keeps withheld wording out of the save", async () => {
    const pdfs: string[] = [];
    let stored: StoredOrdersList[] = [];
    let previous: StoredOrdersEntryRef[] = [];
    const captured: { plan: OrdersWatchPlan | null } = { plan: null };
    const runtime: OrdersRuntime = {
      async fetchText(url) {
        if (url.endsWith("/ordersofthecourt/25")) return { body: fixture("index.html") };
        if (url.endsWith("/relatingtoorders/25")) return { body: fixture("relating.html") };
        return { error: `unexpected ${url}` };
      },
      async fetchPdf(url) {
        pdfs.push(url);
        if (url === LIST && stored.some((row) => row.sourceUrl === LIST && row.parseStatus === "parsed")) return { notModified: true as const };
        if (url === LIST) return { text: fixture("order-list.txt"), contentHash: "hash-v1", lastModified: "Mon, 08 Jun 2026 13:30:00 GMT" };
        if (url === OLDER) return { text: "CERTIORARI DENIED\n25-1 ALPHA V. BETA\nThe petition for a writ of certiorari is denied.\n", contentHash: "hash-old", lastModified: null };
        return { error: "unexpected pdf" };
      },
      async loadLists() { return stored; },
      async loadEntries() { return previous; },
      async loadCandidates() { return [{ id: "case-809", docketNumber: "24-809", supremeCourtTerm: 2024 }]; },
      async apply(plan) { captured.plan = plan; },
    };

    const first = await runScotusOrders(runtime, { termYear: 25, maxPdfs: 1, now: new Date("2026-11-08T16:00:00Z") });
    expect(pdfs).toEqual([LIST]);
    expect(pdfs).not.toContain(MISC);
    expect(first.diagnostic.runSucceeded).toBe(true);
    expect(first.diagnostic.complete).toBe(false);
    expect(first.diagnostic.successfulButIncomplete).toBe(true);
    const savedEntries = JSON.stringify(captured.plan?.writes ?? []);
    expect(savedEntries.toLowerCase()).not.toContain("under seal");
    expect(savedEntries).not.toContain("GASPER");
    const list = first.writes.find((write) => write.action !== "touch" && write.list.sourceUrl === LIST);
    expect(list && list.action !== "touch" ? list.entries.every((entry) => entry.backfilled) : false).toBe(true);

    stored = first.writes.flatMap((write) => write.action === "touch" ? [] : [{
      sourceUrl: write.list.sourceUrl, contentHash: write.list.contentHash, postedOn: write.list.postedOn,
      label: write.list.label, parseStatus: write.list.parseStatus, superseded: false, lastModified: write.list.lastModified,
    }]);
    previous = first.writes.flatMap((write) => write.action === "touch" ? [] : write.entries.map((entry) => ({
      sourceUrl: write.list.sourceUrl, sourceRecordId: entry.sourceRecordId, docketNumber: entry.docketNumber, kind: entry.kind,
    })));
    pdfs.length = 0;
    const second = await runScotusOrders(runtime, { termYear: 25, maxPdfs: 1, now: new Date("2026-11-08T17:00:00Z") });
    expect(pdfs[0]).toBe(LIST);
    expect(pdfs).toContain(OLDER);
    expect(pdfs).not.toContain(MISC);
    expect(second.writes.find((write) => write.action === "touch" && write.sourceUrl === LIST)).toBeTruthy();
    const older = second.writes.find((write) => write.action !== "touch" && write.list.sourceUrl === OLDER);
    expect(older && older.action !== "touch" ? older.entries.every((entry) => entry.backfilled) : false).toBe(true);
  });
});

describe("orders persistence locks", () => {
  const source = readFileSync(join(__dirname, "scotus-orders.ts"), "utf8");
  const migration = readFileSync(join(__dirname, "../../../../db/migrations/0201_scotus_orders_list.sql"), "utf8");
  const script = readFileSync(join(__dirname, "../../../../scripts/run-scotus-orders.ts"), "utf8");

  it("never writes docket entries or subscriber mail, and stores alert_eligible as false", () => {
    expect(source).not.toMatch(/insert into docket_entry/i);
    expect(source).not.toMatch(/insert into entity_alert/i);
    expect(source).not.toMatch(/insert into entity_follow/i);
    expect(source).toContain("false");
    expect(source).toMatch(/alert_eligible\s*\)\s*VALUES \([\s\S]*?\bfalse\b/);
    expect(migration).toContain("CHECK (alert_eligible = false)");
    expect(migration).toContain("CHECK (merits = (kind = 'merits_ruling'))");
    expect(migration).toContain("NOT withheld OR (exact_wording IS NULL AND plain_line IS NULL AND caption IS NULL AND author_text IS NULL)");
    expect(migration).not.toContain("entity_follow");
    expect(migration).not.toContain("docket_entry");
    expect(script).toContain('args.has("backfill")');
    expect(script).toContain('JURVIO_SCOTUS_ORDERS === "off"');
    expect(script).not.toMatch(/insert into docket_entry/i);
  });
});
