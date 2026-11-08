import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runOrdersListCycle, type OrdersListCycleDeps, type StoreListInput } from "./scotus-orders-list";
import { ORDERS_LIST_NOTIFICATIONS_ENABLED, type OrdersListCoverage, type StoredOrdersList } from "../providers/scotus/orders-list";

const indexHtml = readFileSync(join(__dirname, "../providers/scotus/fixtures/orders-index-sample.html"), "utf8");
const listText = readFileSync(join(__dirname, "../providers/scotus/fixtures/orders-list-sample.txt"), "utf8");
const ORIGINAL = "https://www.supremecourt.gov/orders/courtorders/100526zor_2a34.pdf";
const REVISED = "https://www.supremecourt.gov/orders/courtorders/100526zor_revised.pdf";
const NEWER = "https://www.supremecourt.gov/orders/courtorders/101926zor_q8l1.pdf";

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function memory(options: {
  pdfs?: Record<string, Uint8Array | { status: number; retryAfter?: string }>;
  textFor?: (url: string, body: Uint8Array) => string | null;
  cases?: Record<string, string[]>;
  maxPdfs?: number;
  notificationsEnabled?: boolean;
  now?: string;
  indexHtml?: string;
  state?: { liveSince: string | null; lists: StoredOrdersList[] };
  seen?: { sourceUrl: string; firstSeenAt: string }[];
}) {
  const state: { liveSince: string | null; lists: StoredOrdersList[] } = options.state ?? { liveSince: null, lists: [] };
  const seen: { sourceUrl: string; firstSeenAt: string }[] = options.seen ?? [];
  const saved: StoreListInput[] = [];
  let coverage: OrdersListCoverage | null = null;
  const matched: string[] = [];
  const deps: OrdersListCycleDeps = {
    now: () => new Date(options.now ?? "2026-11-08T15:00:00.000Z"),
    termYear: 2026,
    maxPdfs: options.maxPdfs ?? 3,
    notificationsEnabled: options.notificationsEnabled ?? ORDERS_LIST_NOTIFICATIONS_ENABLED,
    fetchText: async () => ({ status: 200, body: options.indexHtml ?? indexHtml }),
    fetchBytes: async (url) => {
      const pdf = options.pdfs?.[url];
      if (pdf && !(pdf instanceof Uint8Array)) return { status: pdf.status, retryAfter: pdf.retryAfter ?? null };
      const body = pdf instanceof Uint8Array ? pdf : bytes(url === NEWER ? "MONDAY, OCTOBER 19, 2026\n\nCERTIORARI DENIED\n\n26-500    LATER, ANN V. LATER, BEN\n" : listText);
      return { status: 200, body };
    },
    extractText: async (body) => {
      const text = new TextDecoder().decode(body);
      return options.textFor ? options.textFor("", body) : text;
    },
    load: async () => ({ liveSince: state.liveSince, lists: state.lists.map((row) => ({ ...row, entryKeys: [...row.entryKeys] })) }),
    rememberIndex: async (_term, links, seenAt) => {
      for (const link of links) {
        if (!seen.some((row) => row.sourceUrl === link.sourceUrl)) seen.push({ sourceUrl: link.sourceUrl, firstSeenAt: seenAt });
      }
      return seen.map((row) => ({ ...row }));
    },
    storeList: async (input) => {
      saved.push(input);
      state.lists = state.lists.map((row) => input.supersedeUrls.includes(row.sourceUrl) ? { ...row, superseded: true } : row);
      state.lists = state.lists.filter((row) => !(row.sourceUrl === input.sourceUrl && row.contentHash === input.contentHash));
      state.lists.push({
        sourceUrl: input.sourceUrl,
        contentHash: input.contentHash,
        listDate: input.indexDate,
        extractionStatus: input.extractionStatus,
        backfilled: input.backfilled,
        superseded: false,
        entryKeys: input.entries.map((entry) => `${entry.docketNumber ?? ""}|${entry.action}|${entry.textHash}`),
        withheldEntries: input.entries.filter((entry) => entry.withheld).length,
        unlinkedEntries: input.entries.filter((entry) => entry.linkStatus === "unlinked").length,
        ambiguousEntries: input.entries.filter((entry) => entry.linkStatus === "ambiguous").length,
      });
    },
    storeCoverage: async (_term, next, liveSince) => {
      coverage = next;
      state.liveSince = state.liveSince ?? liveSince;
    },
    matchCases: async (docket) => {
      matched.push(docket);
      return options.cases?.[docket] ?? [];
    },
  };
  return { deps, state, saved, matched, coverage: () => coverage };
}

describe("orders list cycle", () => {
  it("stores a first index as backfill, withholds sealed text, and does not email", async () => {
    const harness = memory({ cases: { "25-1030": ["case-cummins"], "25-1030-alt": ["case-other"] }, maxPdfs: 3 });
    const result = await runOrdersListCycle(harness.deps);
    expect(result.notifications).toBe("disabled");
    expect(result.emailsSent).toBe(0);
    expect(result.coverage.runStatus).toBe("succeeded");
    expect(result.coverage.completeness).toBe("complete_for_indexed_lists");
    expect(result.stored).toBe(3);
    const entries = harness.saved.flatMap((list) => list.entries);
    expect(entries.every((entry) => entry.backfilled && entry.notify === false)).toBe(true);
    const sealed = entries.find((entry) => entry.docketNumber === "26M4");
    expect(sealed).toMatchObject({ withheld: true, exactText: "", caption: null, linkStatus: "withheld", caseId: null });
    expect(harness.matched).not.toContain("26M4");
    const linked = entries.find((entry) => entry.docketNumber === "25-1030");
    expect(linked?.linkStatus).toBe("linked");
    expect(linked?.caseId).toBe("case-cummins");
    const unseen = entries.find((entry) => entry.docketNumber === "26-100");
    expect(unseen?.linkStatus).toBe("unlinked");
    expect(unseen?.caseId).toBeNull();
  });

  it("leaves a successful partial fetch incomplete", async () => {
    const harness = memory({ maxPdfs: 1 });
    const result = await runOrdersListCycle(harness.deps);
    expect(result.coverage.runStatus).toBe("succeeded");
    expect(result.coverage.completeness).toBe("incomplete");
    expect(result.coverage.pendingLists).toBeGreaterThan(0);
    expect(result.coverage.newestIndexedOn).toBe("2026-10-19");
    expect(result.stored).toBe(1);
  });

  it("does not email a backfill or a repeated amendment, and a rate limit is not completeness", async () => {
    const onlyOriginal = indexHtml.replace(/<div style="display:block">\s*<span style="display:inline-block;">11\/06\/26[\s\S]*?<\/div>\s*/, "")
      .replace(/<div style="display:block">\s*<span style="display:inline-block;">10\/19\/26[\s\S]*?<\/div>\s*/, "")
      .replace(/<div style="display:block">\s*<span style="display:inline-block;">10\/05\/26 &nbsp;<\/span>\s*<span style="display:inline-block;"><a href='\/orders\/courtorders\/100526zor_revised.pdf'[\s\S]*?<\/div>\s*/, "");
    const first = memory({
      maxPdfs: 1, notificationsEnabled: true, indexHtml: onlyOriginal, cases: { "25-1030": ["case-cummins"] },
      pdfs: { [ORIGINAL]: bytes(listText) },
    });
    const opened = await runOrdersListCycle(first.deps);
    expect(opened.stored).toBe(1);
    expect(first.saved[0]?.backfilled).toBe(true);
    expect(first.saved[0]?.entries.every((entry) => entry.notify === false)).toBe(true);

    const amendedText = listText.replace("25-1030   CUMMINS, CHRISTOPHER R. V. ILLINOIS", "25-1030   CUMMINS, CHRISTOPHER R. V. ILLINOIS\n\n26-777    NEW, CASE V. NEW, PARTY");
    const second = memory({
      maxPdfs: 3,
      notificationsEnabled: true,
      now: "2026-11-09T15:00:00.000Z",
      cases: { "25-1030": ["case-cummins"], "26-777": ["case-new"] },
      state: first.state,
      seen: [{ sourceUrl: ORIGINAL, firstSeenAt: "2026-11-08T15:00:00.000Z" }],
      pdfs: { [ORIGINAL]: bytes(listText), [REVISED]: bytes(amendedText) },
    });
    const amended = await runOrdersListCycle(second.deps);
    expect(amended.duplicates).toBeGreaterThan(0);
    const revised = second.saved.find((list) => list.sourceUrl === REVISED);
    expect(revised?.backfilled).toBe(false);
    expect(revised?.supersedeUrls).toContain(ORIGINAL);
    expect(revised?.entries.find((entry) => entry.docketNumber === "25-1030")?.notify).toBe(false);
    const added = revised?.entries.find((entry) => entry.docketNumber === "26-777");
    expect(added?.linkStatus).toBe("linked");
    expect(added?.notify).toBe(true);

    const limited = memory({ pdfs: { [NEWER]: { status: 429, retryAfter: "120" }, [REVISED]: { status: 429 }, [ORIGINAL]: { status: 429 } } });
    const stopped = await runOrdersListCycle(limited.deps);
    expect(stopped.coverage.runStatus).toBe("rate_limited");
    expect(stopped.coverage.completeness).toBe("incomplete");
    expect(stopped.stored).toBe(0);
    expect(stopped.emailsSent).toBe(0);
  });

  it("does not link two candidate cases", async () => {
    const harness = memory({ maxPdfs: 1, cases: { "26-500": ["case-a", "case-b"] } });
    await runOrdersListCycle(harness.deps);
    const entry = harness.saved.flatMap((list) => list.entries).find((item) => item.docketNumber === "26-500");
    expect(entry?.linkStatus).toBe("ambiguous");
    expect(entry?.caseId).toBeNull();
    expect(entry?.notify).toBe(false);
  });

  it("records a failed extraction as incomplete rather than a clean success", async () => {
    const harness = memory({ maxPdfs: 1, textFor: () => null });
    const result = await runOrdersListCycle(harness.deps);
    expect(result.coverage.runStatus).toBe("partial");
    expect(result.coverage.completeness).toBe("incomplete");
    expect(result.coverage.failedLists).toBeGreaterThan(0);
    expect(harness.saved[0]?.entries).toEqual([]);
  });
});

describe("orders list job stays off the mail path", () => {
  it("never inserts docket entries or calls the alert senders", () => {
    const source = readFileSync(join(__dirname, "scotus-orders-list.ts"), "utf8");
    expect(source).not.toMatch(/INSERT INTO docket_entry/i);
    expect(source).not.toMatch(/matchOrCreateDraftCase/);
    expect(source).not.toMatch(/runAlertDigests|sendEntityAlerts/);
    expect(source).toContain("ORDERS_LIST_NOTIFICATIONS_ENABLED");
    expect(source).toContain(", false, ${entry.textHash}");
  });
});
