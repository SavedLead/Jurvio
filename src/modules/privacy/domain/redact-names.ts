/** A full name replaced with initials wherever Jurvio renders or indexes text. */
export interface NameRedactionRule {
  fullName: string;
  initials: string;
}

const NAME_PART = /^[\p{L}][\p{L}'’.-]*$/u;

export function initialsFor(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0];
  const last = parts.length >= 2 ? parts[parts.length - 1]?.[0] : undefined;
  if (!first || !last) throw new Error("a redaction name needs a given name and a surname");
  return `${first.toUpperCase()}.${last.toUpperCase()}.`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function namePart(value: string): string {
  if (!NAME_PART.test(value)) throw new Error("a redaction name has an unsupported character");
  return escapeRegExp(value);
}

/** First [middle initial] Last, and Last, First [middle initial], plus a possessive. */
export function redactionPatterns(fullName: string): RegExp[] {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) throw new Error("a redaction name needs a given name and a surname");
  const first = namePart(parts[0]!);
  const last = namePart(parts[parts.length - 1]!);
  const middle = "(?:\\s+[A-Za-z]\\.?)"
  const possessive = "(?:['’]s)?";
  const end = "(?!\\p{L})";
  return [
    new RegExp(`\\b${first}${middle}?\\s+${last}${end}${possessive}`, "giu"),
    new RegExp(`\\b${last},\\s+${first}${middle}?${end}${possessive}`, "giu"),
  ];
}

export function redactNames(text: string, rules: readonly NameRedactionRule[]): { text: string; changed: boolean } {
  let next = text;
  for (const rule of rules) {
    if (!rule.fullName.trim() || !rule.initials.trim()) continue;
    for (const pattern of redactionPatterns(rule.fullName)) {
      next = next.replace(pattern, (match) => {
        const possessive = /['’]s$/i.test(match) ? "'s" : "";
        return `${rule.initials}${possessive}`;
      });
    }
  }
  return { text: next, changed: next !== text };
}

export function redactNamesInHtml(html: string, rules: readonly NameRedactionRule[]): { text: string; changed: boolean } {
  return redactNames(html, rules);
}
