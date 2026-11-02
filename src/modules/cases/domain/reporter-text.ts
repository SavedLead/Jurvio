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
