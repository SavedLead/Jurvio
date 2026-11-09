/**
 * Court feeds store entry text with markup and escaped characters. The page
 * shows the words. The stored row is left unchanged, so alerts still key off
 * the original insert.
 */
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };

export function plainDocketText(value: string): string {
  let current = value;
  for (let pass = 0; pass < 3; pass += 1) {
    const next = current
      .replace(/<!\[CDATA\[|\]\]>/g, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
        if (code[0] === "#") {
          const point = code[1]?.toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
          return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
        }
        return NAMED[code.toLowerCase()] ?? match;
      });
    if (next === current) break;
    current = next;
  }
  return current.replace(/\s+/g, " ").trim();
}
