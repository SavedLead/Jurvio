import { decodeHtmlEntities } from "@/modules/cases/domain/record-answers";

/** Plain text of an HTML fragment: scripts/styles dropped, block tags become breaks, entities decoded. */
export function htmlToText(html: string): string {
  const withoutCode = html
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const text = withoutCode
    .replace(/<(?:br|\/p|\/div|\/li|\/h\d|\/tr|\/dt|\/dd)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeHtmlEntities(text).replace(/[ \t\r\f\v\u00a0]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

/** The first matching region (e.g. <main>…</main>), else the whole document. */
export function region(html: string, ...patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match) return match[0];
  }
  return html;
}

export interface Link { url: string; label: string }

/** Absolute https links in an HTML fragment, with their visible text. */
export function links(html: string, baseUrl: string): Link[] {
  const found: Link[] = [];
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: URL;
    try { url = new URL(decodeHtmlEntities(match[1]!), baseUrl); } catch { continue; }
    if (url.protocol === "http:") url.protocol = "https:";
    if (url.protocol !== "https:") continue;
    found.push({ url: url.toString(), label: htmlToText(match[2]!).replace(/\s+/g, " ").slice(0, 300) });
  }
  return found;
}

export function rssItems(xml: string): string[] {
  return [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((match) => match[0]);
}

export function rssTag(item: string, name: string): string | null {
  const match = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(item);
  if (!match) return null;
  const value = match[1]!.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1").trim();
  return decodeHtmlEntities(value).trim();
}

export function isoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** A short official excerpt (government works): first sentences up to ~400 characters. */
export function excerpt(text: string, max = 400): string | null {
  const flat = collapse(text);
  if (!flat) return null;
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const sentence = cut.lastIndexOf(". ");
  return sentence > 120 ? cut.slice(0, sentence + 1) : `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}
