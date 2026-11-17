import { describe, expect, it } from "vitest";
import { orderListCards } from "./order-list-cards";

describe("order list cards", () => {
  it("keeps the official PDF and drops a future list date", () => {
    const cards = orderListCards([
      { listDate: "2026-11-16", label: "Order List", pdfUrl: "https://www.supremecourt.gov/orders/courtorders/111626zor_abc.pdf", amended: false, textStored: false },
      { listDate: "2026-11-18", label: "Order List", pdfUrl: "https://www.supremecourt.gov/orders/courtorders/111826zor_def.pdf", amended: false, textStored: false },
      { listDate: "2026-11-09", label: "Order List (Amended)", pdfUrl: "https://example.com/not-the-court.pdf", amended: true, textStored: true },
    ], "2026-11-17");
    expect(cards).toHaveLength(1);
    expect(cards[0]?.pdfUrl).toMatch(/111626zor/);
    expect(cards[0]?.textStored).toBe(false);
  });
});
