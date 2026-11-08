import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isWithheldCaption, isWithheldLine } from "@/modules/ingestion/live-feeds/scotus-emergency";
import {
  ORDERS_FEED_NOTIFICATIONS_ENABLED, chooseOrderListFetches, classifyOrdersBody, listIsHistorical,
  matchOrdersCase, ordersAlertDecision, ordersTermYear, ordersTextWithheld, parseOrderListText, parseOrdersIndex,
  parseRelatingToOrdersIndex, planOrdersWatch, plainOrdersLine, type CaseCandidate, type OrdersWatchInput,
  type StoredOrdersEntryRef, type StoredOrdersList,
} from "./orders-list";

const fixture = (name: string) => readFileSync(join(__dirname, "../fixtures/orders", name), "utf8");
const PAGE = "https://www.supremecourt.gov/orders/ordersofthecourt/25";
const RELATING = "https://www.supremecourt.gov/opinions/relatingtoorders/25";
const LIST = "https://www.supremecourt.gov/orders/courtorders/060826zor_21p3.pdf";
const OLDER = "https://www.supremecourt.gov/orders/courtorders/060126zor_k53l.pdf";
const MISC = "https://www.supremecourt.gov/orders/courtorders/060126zr_onjq.pdf";

function byDocket<T extends { docketNumber: string | null }>(entries: readonly T[], docket: string): T[] {
  return entries.filter((entry) => entry.docketNumber === docket);
}

describe("orders term and index", () => {
  it("uses the October term, which is 26 in November 2026 and 25 the previous July", () => {
    expect(ordersTermYear(new Date("2026-11-08T15:00:00Z"))).toBe(26);
    expect(ordersTermYear(new Date("2026-10-01T14:00:00Z"))).toBe(26);
    expect(ordersTermYear(new Date("2026-07-15T16:00:00Z"))).toBe(25);
  });

  it("reads order lists and miscellaneous orders and drops rules and off-site links", () => {
    const parsed = parseOrdersIndex(fixture("index.html"), 25, PAGE);
    expect(parsed.termMismatch).toBe(false);
    expect(parsed.items.map((item) => [item.label, item.sourceUrl, item.postedOn])).toEqual([
      ["order_list", LIST, "2026-06-08"],
      ["order_list", OLDER, "2026-06-01"],
      ["miscellaneous", MISC, "2026-06-01"],
    ]);
  });

  it("refuses an index whose term label does not match the page we asked for", () => {
    const parsed = parseOrdersIndex(fixture("index.html"), 26, PAGE);
    expect(parsed.termMismatch).toBe(true);
    expect(parsed.items).toEqual([]);
  });

  it("reads opinions relating to orders, including a page fragment, as separate writings", () => {
    const items = parseRelatingToOrdersIndex(fixture("relating.html"), RELATING);
    expect(items.map((item) => [item.docketNumber, item.authorText, item.citation, item.sourceUrl])).toEqual([
      ["24-1015", "NG", "609/2", "https://www.supremecourt.gov/opinions/25pdf/24-1015_hfjm.pdf"],
      ["26A305", "A", "609/2", "https://www.supremecourt.gov/opinions/25pdf/26a305_4g15.pdf#page=2"],
    ]);
    expect(items.every((item) => item.label === "separate_writing")).toBe(true);
  });
});

describe("order list text", () => {
  const entries = parseOrderListText(fixture("order-list.txt"), LIST);

  it("distinguishes a cert denial from a summary order, a grant, and a merits ruling", () => {
    const denial = byDocket(entries, "25-1029")[0];
    expect(denial).toMatchObject({
      kind: "cert_denied",
      merits: false,
      exactWording: "25-1029 UNITED STATES V. COCKERHAM, EDWARD The petition for a writ of certiorari is denied.",
    });
    expect(plainOrdersLine("cert_denied")).toContain("denied review");
    expect(plainOrdersLine("cert_denied")).not.toContain("decided this case on the merits");

    const summary = byDocket(entries, "25-551")[0];
    expect(summary).toMatchObject({ kind: "summary_disposition", merits: false });
    expect(summary?.exactWording).toContain("The judgment is vacated");
    expect(plainOrdersLine("summary_disposition")).not.toContain("decided this case on the merits");

    expect(byDocket(entries, "24-809")[0]).toMatchObject({
      kind: "cert_granted",
      merits: false,
      exactWording: "24-809 SMITH V. JONES The petition for a writ of certiorari is granted.",
    });
    expect(plainOrdersLine("cert_granted")).toContain("has not decided the case yet");

    const merits = parseOrderListText([
      "CERTIORARI DENIED",
      "24-1 EXAMPLE V. SAMPLE",
      "Justice Barrett delivered the opinion of the Court. The judgment of the Court of Appeals is affirmed.",
    ].join("\n"), LIST);
    expect(merits[0]).toMatchObject({ kind: "merits_ruling", merits: true, docketNumber: "24-1" });
    expect(classifyOrdersBody("cert_denied", merits[0]?.exactWording ?? "", false).kind).toBe("merits_ruling");
  });

  it("applies a group denial sentence only to the caption-only lines above it", () => {
    const sentence = "The petitions for writs of certiorari are denied.";
    expect(byDocket(entries, "24-6126")[0]?.exactWording).toBe(`24-6126 ELLIOTT, JOEL S. V. UNITED STATES ${sentence}`);
    expect(byDocket(entries, "25-81")[0]?.exactWording).toBe(`25-81 ORTA, LOIS J. V. UNITED STATES, ET AL. ${sentence}`);
    expect(byDocket(entries, "25-1029")[0]?.exactWording).not.toContain("petitions for writs");
  });

  it("keeps grants, rehearing denials, amendments, and separate writings", () => {
    expect(byDocket(entries, "25-352")[0]).toMatchObject({ kind: "motion_granted", merits: false });
    expect(byDocket(entries, "25-432")[0]).toMatchObject({ kind: "rehearing_denied", merits: false });
    expect(byDocket(entries, "25-100")[0]).toMatchObject({ kind: "amendment", merits: false });
    const writings = byDocket(entries, "24-7245");
    expect(writings.map((entry) => entry.authorText)).toEqual(["SOTOMAYOR", "JACKSON"]);
    expect(writings.every((entry) => entry.kind === "separate_writing" && entry.merits === false)).toBe(true);
    expect(writings[0]?.exactWording).toContain("Statement of JUSTICE SOTOMAYOR");
    expect(writings[1]?.exactWording).toContain("I would grant the petition for a writ of certiorari.");
  });

  it("withholds sealed lines and does not keep their wording", () => {
    const blob = JSON.stringify(entries);
    expect(blob.toLowerCase()).not.toContain("under seal");
    expect(blob).not.toContain("GASPER");
    const withheld = entries.filter((entry) => entry.withheld);
    expect(withheld).toHaveLength(1);
    expect(withheld[0]).toMatchObject({
      docketNumber: "25M82", kind: "withheld", merits: false, caption: null, exactWording: null, authorText: null,
    });
    expect(withheld[0]?.withholdKey).toMatch(/^[a-f0-9]{64}$/);
    const statement = parseOrderListText([
      "No. 24-9",
      "Statement of JUSTICE KAGAN respecting the denial of certiorari.",
      "The filing describes grand jury testimony.",
    ].join("\n"), LIST);
    expect(statement[0]).toMatchObject({ withheld: true, exactWording: null, caption: null, authorText: null });
    expect(JSON.stringify(statement).toLowerCase()).not.toContain("grand jury");
  });

  it("uses the same sealed and restricted words as the emergency lane", () => {
    for (const sample of ["under seal", "grand jury selection", "United States v. Smith", "ex parte Young", "in camera", "a juvenile", "qui tam", "redacted", "search warrant", "minor child", "sealed appendix"]) {
      const emergency = isWithheldLine(sample) || isWithheldCaption(sample);
      expect(ordersTextWithheld(sample), sample).toBe(emergency);
    }
  });
});

describe("conservative case matching", () => {
  const modern: CaseCandidate = { id: "new", docketNumber: "24-809", supremeCourtTerm: 2024 };
  const recycled: CaseCandidate = { id: "old", docketNumber: "24–809", supremeCourtTerm: 1924 };
  const lookalike: CaseCandidate = { id: "other", docketNumber: "24-810", supremeCourtTerm: 2024 };

  it("matches one in-window docket and ignores a recycled century and a different docket", () => {
    expect(matchOrdersCase("24-809", [modern, recycled, lookalike])).toEqual({ status: "matched", caseId: "new", count: 2 });
  });

  it("does not match a caption twin or a docket that exists only in an earlier century", () => {
    expect(matchOrdersCase("24-809", [lookalike])).toEqual({ status: "unmatched", caseId: null, count: 0 });
    expect(matchOrdersCase("24-809", [recycled])).toEqual({ status: "unmatched", caseId: null, count: 1 });
  });

  it("refuses two modern candidates and an undated row sitting beside a dated one", () => {
    const nextTerm: CaseCandidate = { id: "next", docketNumber: "24-809", supremeCourtTerm: 2025 };
    const undated: CaseCandidate = { id: "blank", docketNumber: "24-809", supremeCourtTerm: null };
    expect(matchOrdersCase("24-809", [modern, nextTerm]).status).toBe("ambiguous");
    expect(matchOrdersCase("24-809", [modern, undated])).toEqual({ status: "ambiguous", caseId: null, count: 2 });
    expect(matchOrdersCase("24-809", [undated])).toEqual({ status: "matched", caseId: "blank", count: 1 });
  });
});

describe("duplicates, amendments, and historical alert suppression", () => {
  const text = fixture("order-list.txt");
  const amended = fixture("order-list-amended.txt");
  const base = (over: Partial<OrdersWatchInput>): OrdersWatchInput => ({
    termYear: 25,
    runDay: "2026-11-08",
    explicitBackfill: false,
    ordersIndex: { html: fixture("index.html"), pageUrl: PAGE },
    relatingIndex: { html: fixture("relating.html"), pageUrl: RELATING },
    pdfs: [{ sourceUrl: LIST, text, contentHash: "hash-v1", lastModified: "Mon, 08 Jun 2026 13:30:00 GMT" }],
    stored: [],
    previousEntries: [],
    candidates: [{ id: "case-809", docketNumber: "24-809", supremeCourtTerm: 2024 }],
    ...over,
  });

  it("stores a historical list once, links only the exact docket, and does not arm mail", () => {
    expect(ORDERS_FEED_NOTIFICATIONS_ENABLED).toBe(false);
    expect(listIsHistorical("2026-06-08", "2026-11-08", false)).toBe(true);
    expect(ordersAlertDecision({ historical: true, withheld: false }, true)).toEqual({
      caseFollowEmail: false, feedNotification: false, reason: "historical_backfill",
    });
    expect(ordersAlertDecision({ historical: false, withheld: true }, true).reason).toBe("withheld");
    expect(ordersAlertDecision({ historical: false, withheld: false })).toEqual({
      caseFollowEmail: false, feedNotification: false, reason: "feed_notifications_disabled",
    });

    const plan = planOrdersWatch(base({}));
    const listWrite = plan.writes.find((write) => write.action === "insert" && write.list.sourceUrl === LIST);
    expect(listWrite && listWrite.action !== "touch" ? listWrite.list.backfilled : null).toBe(true);
    const entries = listWrite && listWrite.action !== "touch" ? listWrite.entries : [];
    expect(entries.every((entry) => entry.backfilled)).toBe(true);
    expect(entries.find((entry) => entry.docketNumber === "24-809")).toMatchObject({ caseId: "case-809", matchStatus: "matched" });
    expect(entries.find((entry) => entry.docketNumber === "25-1029")).toMatchObject({ caseId: null, matchStatus: "unmatched" });
    expect(entries.find((entry) => entry.docketNumber === "25M82")).toMatchObject({
      withheld: true, caseId: null, matchStatus: "withheld", exactWording: null, caption: null, plainLine: null,
    });
    expect(JSON.stringify(entries).toLowerCase()).not.toContain("under seal");
    expect(JSON.stringify(entries)).not.toContain("GASPER");
    expect(plan.diagnostic.runSucceeded).toBe(true);
    expect(plan.diagnostic.complete).toBe(false);
    expect(plan.diagnostic.successfulButIncomplete).toBe(true);
    expect(plan.diagnostic.missed.map((row) => row.sourceUrl)).toEqual([OLDER]);
    expect(plan.diagnostic.failures).toEqual([]);
  });

  it("treats the same PDF hash as a duplicate and an edited PDF as an amendment", () => {
    const first = planOrdersWatch(base({}));
    const listWrite = first.writes.find((write) => write.action === "insert" && write.list.sourceUrl === LIST);
    const entries = listWrite && listWrite.action !== "touch" ? listWrite.entries : [];
    const stored: StoredOrdersList[] = first.writes.flatMap((write) => write.action === "touch" ? [] : [{
      sourceUrl: write.list.sourceUrl, contentHash: write.list.contentHash, postedOn: write.list.postedOn,
      label: write.list.label, parseStatus: write.list.parseStatus, superseded: false, lastModified: write.list.lastModified,
    }]);
    const previous: StoredOrdersEntryRef[] = entries.map((entry) => ({
      sourceUrl: LIST, sourceRecordId: entry.sourceRecordId, docketNumber: entry.docketNumber, kind: entry.kind,
    }));
    const duplicate = planOrdersWatch(base({
      stored, previousEntries: previous,
      pdfs: [{ sourceUrl: LIST, notModified: true }],
    }));
    expect(duplicate.writes.filter((write) => write.action !== "touch")).toEqual([]);
    expect(duplicate.writes).toContainEqual({ action: "touch", sourceUrl: LIST });

    const revised = planOrdersWatch(base({
      stored, previousEntries: previous,
      pdfs: [{ sourceUrl: LIST, text: amended, contentHash: "hash-v2", lastModified: "Tue, 09 Jun 2026 15:00:00 GMT" }],
    }));
    const supersede = revised.writes.find((write) => write.action === "supersede");
    expect(supersede && supersede.action === "supersede" ? supersede.previousHash : null).toBe("hash-v1");
    const changed = supersede && supersede.action === "supersede" ? supersede.entries : [];
    expect(changed.map((entry) => entry.docketNumber).sort()).toEqual(["24-809", "25-200"]);
    expect(changed.find((entry) => entry.docketNumber === "24-809")?.exactWording).toContain("limited to Question 1");
    expect(changed.find((entry) => entry.docketNumber === "24-809")?.amendedFrom).toBe(
      previous.find((entry) => entry.docketNumber === "24-809")?.sourceRecordId,
    );
    expect(changed.every((entry) => entry.backfilled)).toBe(true);
    expect(changed.find((entry) => entry.docketNumber === "25-81")).toBeUndefined();
  });

  it("keeps a list posted today unmarked as history while mail stays off", () => {
    const html = fixture("index.html").replaceAll("06/08/26", "11/08/26").replaceAll("06/01/26", "11/08/26");
    const plan = planOrdersWatch(base({
      runDay: "2026-11-08",
      ordersIndex: { html, pageUrl: PAGE },
      explicitBackfill: false,
    }));
    const listWrite = plan.writes.find((write) => write.action !== "touch" && write.list.sourceUrl === LIST);
    expect(listWrite && listWrite.action !== "touch" ? listWrite.list.backfilled : null).toBe(false);
    expect(listWrite && listWrite.action !== "touch" ? listWrite.entries.every((entry) => entry.backfilled) : null).toBe(false);
    expect(ordersAlertDecision({ historical: false, withheld: false }).feedNotification).toBe(false);
  });

  it("marks an explicit backfill as history even when the list was posted today", () => {
    expect(listIsHistorical("2026-11-08", "2026-11-08", true)).toBe(true);
    expect(ordersAlertDecision({ historical: true, withheld: false }).reason).toBe("historical_backfill");
  });
});

describe("coverage diagnostics", () => {
  const input = (over: Partial<OrdersWatchInput>): OrdersWatchInput => ({
    termYear: 25,
    runDay: "2026-11-08",
    explicitBackfill: false,
    ordersIndex: { html: fixture("index.html"), pageUrl: PAGE },
    relatingIndex: { html: fixture("relating.html"), pageUrl: RELATING },
    pdfs: [],
    stored: [],
    previousEntries: [],
    candidates: [],
    ...over,
  });

  it("keeps a failed index distinct from a successful run that is still incomplete", () => {
    const failed = planOrdersWatch(input({ ordersIndex: { error: "HTTP 503" }, relatingIndex: null }));
    expect(failed.diagnostic).toMatchObject({
      runSucceeded: false, complete: false, successfulButIncomplete: false, ordersIndexKnown: false, missed: [],
    });
    expect(failed.diagnostic.failures.map((failure) => failure.stage)).toEqual(["orders_index"]);
    expect(failed.writes).toEqual([]);

    const incomplete = planOrdersWatch(input({}));
    expect(incomplete.diagnostic.runSucceeded).toBe(true);
    expect(incomplete.diagnostic.complete).toBe(false);
    expect(incomplete.diagnostic.successfulButIncomplete).toBe(true);
    expect(incomplete.diagnostic.missed.map((row) => row.reason)).toEqual(["unparsed", "unparsed"]);
    expect(incomplete.diagnostic.failures).toEqual([]);
  });

  it("reports a PDF failure and a stale stored date without calling the run a success at completeness", () => {
    const pdfFailed = planOrdersWatch(input({
      pdfs: [{ sourceUrl: LIST, error: "HTTP 500" }],
    }));
    expect(pdfFailed.diagnostic.runSucceeded).toBe(true);
    expect(pdfFailed.diagnostic.complete).toBe(false);
    expect(pdfFailed.diagnostic.failures).toEqual([{ stage: "order_list_pdf", sourceUrl: LIST, message: "HTTP 500" }]);

    const stale = planOrdersWatch(input({
      stored: [{
        sourceUrl: LIST, contentHash: "parsed-hash", postedOn: "2026-06-01", label: "order_list",
        parseStatus: "parsed", superseded: false, lastModified: "Mon, 01 Jun 2026 13:30:00 GMT",
      }],
      pdfs: [{ sourceUrl: LIST, notModified: true }],
      relatingIndex: { error: "HTTP 404" },
    }));
    expect(stale.diagnostic.stale).toEqual([{
      sourceUrl: LIST, storedPostedOn: "2026-06-01", officialPostedOn: "2026-06-08",
    }]);
    expect(stale.diagnostic.failures.map((failure) => failure.stage)).toContain("relating_index");
    expect(stale.diagnostic.complete).toBe(false);
  });

  it("is complete only when the index check worked and every current order list is parsed", () => {
    const first = planOrdersWatch(input({
      pdfs: [
        { sourceUrl: LIST, text: fixture("order-list.txt"), contentHash: "a" },
        { sourceUrl: OLDER, text: "CERTIORARI DENIED\n25-1 A V. B\nThe petition for a writ of certiorari is denied.\n", contentHash: "b" },
      ],
    }));
    expect(first.diagnostic.missed).toEqual([]);
    expect(first.diagnostic.complete).toBe(true);
    expect(first.diagnostic.successfulButIncomplete).toBe(false);
    expect(first.diagnostic.runSucceeded).toBe(true);
  });
});

describe("fetch choice", () => {
  const items = parseOrdersIndex(fixture("index.html"), 25, PAGE).items;

  it("downloads the newest unparsed order list and never a miscellaneous order", () => {
    const choice = chooseOrderListFetches(items, []);
    expect(choice.revalidate).toBeNull();
    expect(choice.downloads[0]).toBe(LIST);
    expect(choice.downloads).not.toContain(MISC);
  });

  it("rechecks the newest parsed list and continues with the next unparsed order list", () => {
    const choice = chooseOrderListFetches(items, [{
      sourceUrl: LIST, contentHash: "a", postedOn: "2026-06-08", label: "order_list",
      parseStatus: "parsed", superseded: false, lastModified: "Mon, 08 Jun 2026 13:30:00 GMT",
    }]);
    expect(choice.revalidate).toEqual({ sourceUrl: LIST, lastModified: "Mon, 08 Jun 2026 13:30:00 GMT" });
    expect(choice.downloads).toEqual([OLDER]);
  });
});
