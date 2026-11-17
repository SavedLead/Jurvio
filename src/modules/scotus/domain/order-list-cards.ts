/**
 * Order-list cards for /supreme-court. The official PDF is the link.
 * A Jurvio page is never invented for a list whose lines are not stored yet.
 */
const PDF = /^https:\/\/www\.supremecourt\.gov\/.+\.pdf(?:[?#].*)?$/i;

export interface OrderListCardInput {
  listDate: string;
  label: string;
  pdfUrl: string;
  amended: boolean;
  /** Parsed lines stored on Jurvio. False means the page links only the Court's PDF. */
  textStored: boolean;
}

export interface OrderListCard {
  listDate: string;
  label: string;
  pdfUrl: string;
  amended: boolean;
  textStored: boolean;
}

export function orderListCards(rows: readonly OrderListCardInput[], today: string): OrderListCard[] {
  const cards: OrderListCard[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const day = row.listDate.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day > today) continue;
    if (!PDF.test(row.pdfUrl)) continue;
    const key = row.pdfUrl.split("#")[0]?.toLowerCase() ?? row.pdfUrl;
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push({
      listDate: day,
      label: row.label.replace(/\s+/g, " ").trim() || "Order list",
      pdfUrl: row.pdfUrl,
      amended: row.amended,
      textStored: row.textStored,
    });
  }
  return cards.sort((a, b) => b.listDate.localeCompare(a.listDate) || a.label.localeCompare(b.label));
}
