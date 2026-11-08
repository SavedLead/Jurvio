import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseOrderListText } from "./order-list-text";
import { parseOfficialOrdersIndex, parseRelatingToOrdersIndex } from "./official-orders";
import { buildScotusCoverageReport } from "@/modules/scotus/domain/coverage-report";

const LIST = `
(ORDER LIST: 610 U.S.)
MONDAY, OCTOBER 19, 2026
CERTIORARI -- SUMMARY DISPOSITION
25-1269
BURFORD GERMAN FUNDING, ET AL. V. FINANCIALRIGHT CLAIMS GMBH
The petition for a writ of certiorari is granted. The judgment is vacated, and the case is remanded to the United States Court of Appeals for the Third Circuit.
ORDERS IN PENDING CASES
26M27
RENTERIA, MARTIN V. UNITED STATES
The motion for leave to file a petition for a writ of certiorari with the supplemental appendix under seal is granted.
CERTIORARI GRANTED
26-204
DEPT. OF JUSTICE, ET AL. V. SCOTT McNUTT, ET AL.
The petition for a writ of certiorari is granted.
CERTIORARI DENIED
25-1158
HADLEY, AMY V. SOUTH BEND, IN, ET AL.
25-1163
PENA, CARLOS V. LOS ANGELES, CA
The petitions for writs of certiorari are denied.
26-34
HANAWAY, ATT'Y GEN. MO., ET AL. V. SANDERSON, THOMAS
The petition for a writ of certiorari is denied. Justice Alito would grant the petition for a writ of certiorari.
`;

describe("official order list text", () => {
  const parsed = parseOrderListText(LIST);

  it("treats a grant plus vacatur as a merits disposition, not a cert denial", () => {
    const item = parsed.items.find((row) => row.docketNumber === "25-1269" && row.itemKind === "disposition");
    expect(item?.disposition).toBe("merits_disposition");
    expect(item?.body).toMatch(/judgment is vacated/i);
  });

  it("denies cert for a grouped list and keeps a would-grant as its own writing", () => {
    const denied = parsed.items.filter((row) => row.disposition === "cert_denied").map((row) => row.docketNumber);
    expect(denied).toEqual(["25-1158", "25-1163", "26-34"]);
    const writing = parsed.items.find((row) => row.docketNumber === "26-34" && row.itemKind === "separate_writing");
    expect(writing?.writingKind).toBe("would_grant");
    expect(writing?.body).toMatch(/Justice Alito would grant/);
    const order = parsed.items.find((row) => row.docketNumber === "26-34" && row.itemKind === "disposition");
    expect(order?.body).not.toMatch(/would grant/);
  });

  it("drops a sealed line instead of storing it", () => {
    expect(parsed.withheld).toBe(1);
    expect(parsed.items.some((row) => /under seal/i.test(`${row.caption ?? ""} ${row.body ?? ""}`))).toBe(false);
    expect(parsed.items.some((row) => row.docketNumber === "26M27")).toBe(false);
  });

  it("keeps a plain cert grant distinct from a denial", () => {
    expect(parsed.items.find((row) => row.docketNumber === "26-204")?.disposition).toBe("cert_granted");
  });
});

describe("official orders index", () => {
  const html = `
    <span style="display:inline-block;">10/19/26 &nbsp;</span>
    <span style="display:inline-block;"><a href='/orders/courtorders/101926zor_q8l1.pdf' target='_blank' >Order List</a></span>
    <span style="display:inline-block;">10/19/26 &nbsp;</span>
    <span style="display:inline-block;"><a href='/orders/courtorders/101926zor2_q8l1.pdf' target='_blank' >Order List (Amended)</a></span>
    <span style="display:inline-block;">11/06/26 &nbsp;</span>
    <span style="display:inline-block;"><a href='/orders/courtorders/110626zr_q8l1.pdf' target='_blank' >Miscellaneous Order</a></span>
  `;

  it("keeps an amended list as its own record", () => {
    const entries = parseOfficialOrdersIndex(html, "26", "https://www.supremecourt.gov/orders/ordersofthecourt/26");
    expect(entries.map((entry) => [entry.kind, entry.amended, entry.sourceRecordId])).toEqual([
      ["order_list", false, "26:101926zor_q8l1.pdf"],
      ["order_list", true, "26:101926zor2_q8l1.pdf"],
      ["miscellaneous", false, "26:110626zr_q8l1.pdf"],
    ]);
    expect(entries[0]?.listDate).toBe("2026-10-19");
    expect(entries[0]?.indexEntryHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("keeps a revised relating-to-orders PDF beside the original", () => {
    const row = `
      <tr>
        <td style="text-align: center;">10/22/26</td>
        <td style="text-align: center;">26A512</td>
        <td><a href='/opinions/26pdf/26a512_new_daeh.pdf'>Scanlan v. Coalition for Open Democracy</a>
          <b>Revisions</b>: <a href='/opinions/26pdf/26a512_diff_08m1.pdf'>10/23/26</a></td>
      </tr>`;
    const [opinion] = parseRelatingToOrdersIndex(row, "26");
    expect(opinion?.sourceUrl).toBe("https://www.supremecourt.gov/opinions/26pdf/26a512_new_daeh.pdf");
    expect(opinion?.revision?.sourceUrl).toBe("https://www.supremecourt.gov/opinions/26pdf/26a512_diff_08m1.pdf");
    expect(opinion?.revision?.listDate).toBe("2026-10-23");
  });
});

describe("SCOTUS coverage report", () => {
  it("does not treat a frontier as complete coverage", () => {
    const report = buildScotusCoverageReport({
      retrievedAt: "2026-11-08T14:24:00.000Z",
      slipOpinions: [{ termYear: "26", filedOn: "2026-10-14", docketNumber: "26A476", caseName: "FCC v. Brown" }],
      orders: [],
      relating: [],
      frontiers: [{ series: "paid", high: "26-600", next: "26-601", nextStatus: 404, spotChecksAbove: [] }],
      knownDockets: [],
    });
    expect(report.missing?.slip).toEqual(["26A476"]);
    expect(report.unknowns.some((line) => /frontier/i.test(line))).toBe(true);
    expect(report.unknowns.some((line) => /not counted/i.test(line))).toBe(true);
  });
});

describe("order ingestion stays off the alert path", () => {
  it("does not write docket entries or alert rows", () => {
    const source = readFileSync("src/modules/ingestion/application/ingest-official-scotus-orders.ts", "utf8");
    expect(source).toContain("ORDER_INGEST_ALERTS_ENABLED = false");
    expect(source).not.toMatch(/INSERT INTO (docket_entry|entity_alert|direct_court_event|case_follow)/);
  });
});
