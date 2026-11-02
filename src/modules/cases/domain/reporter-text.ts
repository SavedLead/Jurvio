/**
 * Text read from a printed U.S. Reports PDF carries the page's running head into the middle of a
 * sentence ("… removal. 260 RILEY v. BONDI Syllabus An order …", "Cite as: 604 U. S. 1 (2025)").
 * Remove those heads; nothing else in the text changes.
 */
export function stripReporterRunningHeads(text: string): string {
  return text
    .replace(/\s\d{1,4}\s+[A-Z][A-Z0-9 .,'’&-]*?\bv\.\s+[A-Z][A-Z0-9 .,'’&-]*?\s+(?:Syllabus|Opinion of the Court)\b\s*/g, " ")
    .replace(/\s*Cite as:\s*\d+\s+U\.\s?S\.\s+(?:_+|\d+)\s*\(\d{4}\)\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Rejoin words a printed page split across a line ("pro- ceedings" → "proceedings"). Only a
 * lowercase letter, a hyphen, a space and a lowercase word that is not "and"/"or"/"to" are joined,
 * so real compounds such as "pre- and post-trial" stay as printed.
 */
export function joinLineBreakHyphens(text: string): string {
  return text.replace(/([a-z])- (?!(?:and|or|to)\b)([a-z])/g, "$1$2");
}

/** Sentences, without breaking after legal abbreviations ("D. C.", "U. S.", "v.", "No.", "F. 4th", "App."). */
export function splitSentences(text: string): string[] {
  return text.replace(/\s+/g, " ").split(/(?<=[.?!])(?<!\b(?:[A-Z]|v|No|Nos|Inc|Co|Corp|St|Mr|Ms|Dr|al|Cf|e\.g|i\.e|App|Supp|Cir|Stat|ed|ibid|id|Id|J|JJ|C)\.)\s+(?=[A-Z(“"])/);
}

/**
 * A short excerpt for a one-page summary: whole sentences up to `maxChars`, never cutting a
 * sentence in the middle unless the first sentence alone is longer. `truncated` says whether
 * anything was left out, so the page can point to the full text.
 */
export function briefExcerpt(text: string, maxChars = 700): { text: string; truncated: boolean } {
  const clean = joinLineBreakHyphens(stripReporterRunningHeads(text));
  if (clean.length <= maxChars) return { text: clean, truncated: false };
  let out = "";
  for (const sentence of splitSentences(clean)) {
    const next = out ? `${out} ${sentence}` : sentence;
    if (out && next.length > maxChars) break;
    out = next;
    if (out.length > maxChars) break;
  }
  out = out.trim();
  if (out.length > maxChars) out = `${out.slice(0, maxChars).replace(/\s+\S*$/, "")}…`;
  return { text: out, truncated: true };
}

/** True when a text field holds no readable words (for example a stray "1."). */
export function isBlankish(text: string | null | undefined): boolean {
  return !text || (text.match(/[A-Za-z]{2,}/g) ?? []).length < 3;
}
