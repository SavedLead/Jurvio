/**
 * Filings that do not need a model. The match is the words on the docket
 * line. A case whose filings are all routine is skipped.
 */

const ROUTINE_FILING = /\b(extension of time|motion for (?:an )?extension|minute order|scheduling order|notice of (?:hearing|appearance|electronic filing)|clerk'?s notice|certificate of service|proof of service|pro hac vice|corporate disclosure statement)\b/i;

export function isRoutineFiling(description: string): boolean {
  return ROUTINE_FILING.test(description.replace(/\s+/g, " ").trim());
}
