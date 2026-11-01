import { latestPublicationColumnSql } from "@/modules/publication/application/current-visibility";

/**
 * Cases that may carry news links. Never a sealed, restricted, suppressed or
 * non-displayable case; never a caption or docket type that signals sealed,
 * grand jury, juvenile, pseudonymous or warrant proceedings; never a case with
 * a restricted court event. Used both when matching and when reading, so a
 * case that becomes restricted later loses its news section immediately.
 * `alias` is the legal_case alias in the surrounding query.
 */
export function caseNewsEligibleSql(alias = "c"): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(alias)) throw new Error("invalid alias");
  return `(
    ${alias}.publication = 'published'
    AND ${latestPublicationColumnSql("displayable", "legal_case", `${alias}.id`)}
    AND ${alias}.caption !~* '\\m(sealed|under seal|redacted|grand jury|juvenile|minor child|a minor|in re search|search warrant|doe|roe|anonymous)\\M'
    AND ${alias}.docket_number !~* '-(mj|gj|sw|sealed)-'
    AND NOT EXISTS (SELECT 1 FROM direct_court_event restricted_event
      WHERE restricted_event.case_id = ${alias}.id AND restricted_event.restricted)
  )`;
}

/** Same rule for captions held in memory (RSS candidates found by docket or name). */
export function captionLooksRestricted(caption: string, docketNumber: string): boolean {
  return /\b(sealed|under seal|redacted|grand jury|juvenile|minor child|a minor|in re search|search warrant|doe|roe|anonymous)\b/i.test(caption)
    || /-(mj|gj|sw|sealed)-/i.test(docketNumber);
}
