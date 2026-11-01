/**
 * Sealed-related cases stay displayable but are kept out of search engines
 * (David, 2026-10-31): never listed in a sitemap and always served noindex.
 *
 * A case is search-excluded when either
 *   - its caption names a seal ("In re: Sealed Case", "Under Seal"), or
 *   - any of its docket events was flagged restricted at ingestion
 *     (isRestrictedDirectEvent: sealed, minor, juvenile, grand jury, qui tam ...).
 *
 * This is a rule evaluated on every query, not a stored list, so new cases and
 * new restricted events are excluded automatically.
 */
export const SEARCH_EXCLUDED_CAPTION_PATTERN = "\\m(sealed|under seal)\\M";

const CAPTION_RE = /\b(sealed|under seal)\b/i;

/** SQL boolean expression: true when the case aliased `alias` must stay out of search. */
export function searchExcludedCaseSql(alias: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error(`invalid SQL alias: ${alias}`);
  return `(${alias}.caption ~* '${SEARCH_EXCLUDED_CAPTION_PATTERN}' OR EXISTS (SELECT 1 FROM direct_court_event search_exclusion_event WHERE search_exclusion_event.case_id = ${alias}.id AND search_exclusion_event.restricted))`;
}

/** Caption half of the rule, for code paths that already hold the caption. */
export function captionIsSearchExcluded(caption: string): boolean {
  return CAPTION_RE.test(caption);
}
