import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isWithheldLine } from "../../live-feeds/scotus-emergency";
import {
  ORDERS_LIST_COVERAGE_NOTE,
  ORDERS_LIST_NOTIFICATIONS_ENABLED,
  assessOrdersListCoverage,
  linkOrdersListEntry,
  octoberTermYear,
  ordersListPlainEnglish,
  ordersListTextWithheld,
  parseOrdersIndex,
  parseOrdersListText,
  planOrdersListFetches,
  revisionForIncoming,
  shouldNotifyOrdersListEntry,
  type StoredOrdersList,
} from "./orders-list";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");

function byDocket(text: string, indexDate = "2026-10-05") {
  const parsed = parseOrdersListText(text, indexDate);
  return {
    parsed,
    entry(docket: string) {
      const found = parsed.entries.filter((item) => item.docketNumber === docket);
      expect(found, docket).toHaveLength(1);
      return found[0]!;
    },
  };
}

describe("orders index", () => {
  const links = parseOrdersIndex(fixture("orders-index-sample.html"));

  it("keeps order lists and drops miscellaneous orders and other hosts", () => {
    expect(links.map((link) => link.sourceUrl)).toEqual([
      "https://www.supremecourt.gov/orders/courtorders/101926zor_q8l1.pdf",
      "https://www.supremecourt.gov/orders/courtorders/100526zor_revised.pdf",
      "https://www.supremecourt.gov/orders/courtorders/100526zor_2a34.pdf",
    ]);
    expect(links.map((link) => link.listDate)).toEqual(["2026-10-19", "2026-10-05", "2026-10-05"]);
    expect(links.filter((link) => link.amendedHint).map((link) => link.label)).toEqual(["Order List (Revised)"]);
  });

  it("uses the October term year, not the July docket year", () => {
    expect(octoberTermYear(new Date("2026-11-08T00:00:00Z"))).toBe(2026);
    expect(octoberTermYear(new Date("2026-09-15T00:00:00Z"))).toBe(2025);
  });
});

describe("orders list text", () => {
  const text = fixture("orders-list-sample.txt");
  const { parsed, entry } = byDocket(text);

  it("reads the printed date and does not treat a cert denial as a merits decision", () => {
    expect(parsed.printedDate).toBe("2026-10-05");
    expect(parsed.dateMismatch).toBe(false);
    const denial = entry("25-1030");
    expect(denial.action).toBe("cert_denied");
    expect(denial.action).not.toBe("merits_decision");
    expect(denial.plainHeadline).toBe("The Supreme Court denied review.");
    expect(denial.plainDetail).toContain("not a decision on who was right");
    expect(denial.exactText).toContain("CUMMINS, CHRISTOPHER R. V. ILLINOIS");
    expect(denial.exactText).not.toContain("would grant");
  });

  it("keeps a grant, a summary action, and an equally divided judgment apart", () => {
    expect(entry("26-100").action).toBe("cert_granted");
    expect(entry("26-100").plainDetail).toContain("has not decided who wins");
    const summary = entry("26-48");
    expect(summary.action).toBe("summary_disposition");
    expect(summary.action).not.toBe("merits_decision");
    expect(summary.exactText).toContain("judgment is vacated");
    expect(summary.plainDetail).toContain("summary action");
    expect(entry("26-300").action).toBe("merits_decision");
    expect(entry("26-300").plainDetail).toContain("divided evenly");
    expect(entry("26-300").uncertainty).toContain("heading");
    expect(entry("26-400").action).toBe("merits_decision");
    expect(entry("26-400").plainDetail).toContain("without deciding the question");
  });

  it("shares a plural summary order and does not copy a later note onto earlier denials", () => {
    const first = entry("25-901");
    const second = entry("25-918");
    expect(first.action).toBe("summary_disposition");
    expect(second.action).toBe("summary_disposition");
    expect(first.exactText).toBe(second.exactText);
    expect(first.exactText).toContain("petitions for writs of certiorari are granted");
    expect(entry("25-1030").exactText).not.toContain("Kavanaugh");
  });

  it("records a would-grant note as a separate writing on a denial", () => {
    const noted = entry("26-183");
    expect(noted.action).toBe("cert_denied");
    expect(noted.separateWritings.map((writing) => writing.kind)).toContain("would_grant");
    expect(noted.exactText).toContain("Justice Kavanaugh would grant the petition for a writ of certiorari.");
    expect(noted.plainDetail).toContain("not the Court's ruling");
    expect(noted.plainHeadline).not.toContain("agreed to hear");
  });

  it("treats a Rule 39.8 dismissal as a dismissal, not a denial or a merits decision", () => {
    const dismissed = entry("26-200");
    expect(dismissed.action).toBe("cert_dismissed");
    expect(dismissed.plainHeadline).toBe("The Supreme Court dismissed the petition.");
    expect(dismissed.plainDetail).toContain("not a ruling on who was right");
  });

  it("does not call a stay denial a cert denial", () => {
    const stay = entry("26A97");
    expect(stay.action).toBe("procedural_order");
    expect(stay.plainHeadline).toBe("The Supreme Court denied a request for a stay.");
    expect(stay.plainDetail).toContain("not a decision on a petition for review");
  });

  it("withholds sealed entries and does not keep their text", () => {
    const sealed = entry("26M4");
    expect(sealed.withheld).toBe(true);
    expect(sealed.caption).toBeNull();
    expect(sealed.exactText).toBe("");
    expect(sealed.separateWritings).toEqual([]);
    expect(sealed.plainDetail).toContain("not stored");
    expect(JSON.stringify(parsed.entries)).not.toMatch(/SEALED APPELLANT|under seal/i);
  });

  it("attaches a separate writing by the printed docket number and not by the case name", () => {
    const writing = entry("25-7499");
    expect(writing.action).toBe("cert_denied");
    expect(writing.caption).toBeNull();
    expect(writing.separateWritings.some((item) => item.kind === "statement" && item.exactText.includes("JUSTICE SOTOMAYOR"))).toBe(true);
    expect(writing.plainDetail).toContain("not a decision on who was right");
    expect(parsed.entries.some((item) => item.caption?.includes("MULKEY"))).toBe(false);
  });

  it("flags a printed date that disagrees with the index", () => {
    expect(parseOrdersListText(text, "2026-10-06").dateMismatch).toBe(true);
  });

  it("withholds a redacted line and matches the emergency filter", () => {
    const redacted = parseOrdersListText([
      "MONDAY, OCTOBER 5, 2026",
      "ORDERS IN PENDING CASES",
      "26A1    PUBLIC, ANNE V. PUBLIC, BEN",
      "The motion for leave to file redacted copies of the application is granted.",
    ].join("\n"), "2026-10-05");
    expect(redacted.entries[0]?.withheld).toBe(true);
    expect(redacted.entries[0]?.exactText).toBe("");
    for (const sample of ["under seal", "sealed appendix", "juvenile record", "redacted copies", "Petition DENIED"]) {
      expect(ordersListTextWithheld(sample)).toBe(isWithheldLine(sample));
    }
  });

  it("says so when the text does not support a label", () => {
    const plain = ordersListPlainEnglish({ action: "unclassified", sectionHeading: "", body: "See the order.", writings: [], conflict: false });
    expect(plain.detail).toContain("cannot tell");
    expect(plain.uncertainty).toContain("not labeled");
  });
});

describe("linking, duplicates, and notification gates", () => {
  it("links one case and refuses zero or several", () => {
    expect(linkOrdersListEntry(["case-1"])).toEqual({ status: "linked", caseId: "case-1" });
    expect(linkOrdersListEntry(["case-1", "case-1"])).toEqual({ status: "linked", caseId: "case-1" });
    expect(linkOrdersListEntry([])).toEqual({ status: "unlinked", caseId: null });
    expect(linkOrdersListEntry(["case-1", "case-2"])).toEqual({ status: "ambiguous", caseId: null });
  });

  it("treats the same file as a duplicate and a second file on the same date as an amendment", () => {
    const stored: StoredOrdersList[] = [{
      sourceUrl: "https://www.supremecourt.gov/orders/courtorders/100526zor_2a34.pdf",
      contentHash: "a".repeat(64), listDate: "2026-10-05", extractionStatus: "ok", backfilled: true,
      superseded: false, entryKeys: [], withheldEntries: 0, unlinkedEntries: 0, ambiguousEntries: 0,
    }];
    expect(revisionForIncoming({ sourceUrl: stored[0]!.sourceUrl, contentHash: "a".repeat(64), listDate: "2026-10-05", stored }).action).toBe("duplicate");
    const amended = revisionForIncoming({
      sourceUrl: "https://www.supremecourt.gov/orders/courtorders/100526zor_revised.pdf",
      contentHash: "b".repeat(64), listDate: "2026-10-05", stored,
    });
    expect(amended.action).toBe("store");
    expect(amended.supersedeUrls).toEqual([stored[0]!.sourceUrl]);
  });

  it("does not email backfill, withheld rows, duplicates, or anything while the feed is off", () => {
    expect(ORDERS_LIST_NOTIFICATIONS_ENABLED).toBe(false);
    const base = { backfilled: false, withheld: false, superseded: false, duplicateOfExisting: false, linkStatus: "linked" as const, notificationsEnabled: true };
    expect(shouldNotifyOrdersListEntry(base)).toBe(true);
    expect(shouldNotifyOrdersListEntry({ ...base, backfilled: true })).toBe(false);
    expect(shouldNotifyOrdersListEntry({ ...base, withheld: true })).toBe(false);
    expect(shouldNotifyOrdersListEntry({ ...base, duplicateOfExisting: true })).toBe(false);
    expect(shouldNotifyOrdersListEntry({ ...base, superseded: true })).toBe(false);
    expect(shouldNotifyOrdersListEntry({ ...base, linkStatus: "unlinked" })).toBe(false);
    expect(shouldNotifyOrdersListEntry({ ...base, linkStatus: "ambiguous" })).toBe(false);
    expect(shouldNotifyOrdersListEntry({ ...base, notificationsEnabled: false })).toBe(false);
    expect(shouldNotifyOrdersListEntry({ ...base, notificationsEnabled: ORDERS_LIST_NOTIFICATIONS_ENABLED })).toBe(false);
  });
});

describe("coverage diagnostics", () => {
  const links = [
    { sourceUrl: "https://www.supremecourt.gov/orders/courtorders/101926zor_q8l1.pdf", listDate: "2026-10-19" },
    { sourceUrl: "https://www.supremecourt.gov/orders/courtorders/100526zor_2a34.pdf", listDate: "2026-10-05" },
  ];
  const stored = (url: string, date: string, status: "ok" | "failed" = "ok"): StoredOrdersList => ({
    sourceUrl: url, contentHash: "a".repeat(64), listDate: date, extractionStatus: status, backfilled: true,
    superseded: false, entryKeys: [], withheldEntries: 0, unlinkedEntries: 1, ambiguousEntries: 0,
  });

  it("calls a successful run incomplete while an indexed list is still missing", () => {
    const coverage = assessOrdersListCoverage({
      runStatus: "succeeded", links, stored: [stored(links[1]!.sourceUrl, links[1]!.listDate)],
    });
    expect(coverage.runStatus).toBe("succeeded");
    expect(coverage.completeness).toBe("incomplete");
    expect(coverage.pendingLists).toBe(1);
    expect(coverage.newestIndexedOn).toBe("2026-10-19");
    expect(coverage.newestStoredOn).toBe("2026-10-05");
    expect(coverage.note).toContain("does not mean every order");
    expect(coverage.note.toLowerCase()).not.toContain("perfect");
    expect(coverage.note).toContain("not instant");
    expect(ORDERS_LIST_COVERAGE_NOTE.toLowerCase()).not.toContain("complete coverage");
  });

  it("is complete for the index only when every linked list has text and the run succeeded", () => {
    const ready = assessOrdersListCoverage({
      runStatus: "succeeded", links, stored: links.map((link) => stored(link.sourceUrl, link.listDate)),
    });
    expect(ready.completeness).toBe("complete_for_indexed_lists");
    const limited = assessOrdersListCoverage({
      runStatus: "rate_limited", links, stored: links.map((link) => stored(link.sourceUrl, link.listDate)), rateLimitUntil: "2026-11-08T18:00:00.000Z",
    });
    expect(limited.completeness).toBe("incomplete");
    expect(limited.rateLimitUntil).toBe("2026-11-08T18:00:00.000Z");
  });

  it("plans newest missing lists first and leaves the rest for a later run", () => {
    const planned = planOrdersListFetches({
      links: links.map((link, position) => ({ ...link, label: "Order List", amendedHint: false, position })),
      stored: [], maxPdfs: 1,
    });
    expect(planned.map((item) => item.link.listDate)).toEqual(["2026-10-19"]);
  });
});
