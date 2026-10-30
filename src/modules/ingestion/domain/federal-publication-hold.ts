export const MISSING_READABLE_CONTENT_REASON = "missing_readable_content";

/**
 * A current-rule hold keeps the case out of the publisher unless the owner has
 * enabled metadata-only publication AND missing opinion text is the only reason.
 * Any additional reason (unverified court, sealed text, collision, ...) still suppresses.
 * This is the predicate the candidate SQL must match.
 */
export function federalHoldSuppressesCandidate(
  reasons: readonly string[],
  allowMetadataWithoutOpinionText: boolean,
): boolean {
  const onlyMissingText =
    reasons.length === 1 && reasons[0] === MISSING_READABLE_CONTENT_REASON;
  if (allowMetadataWithoutOpinionText && onlyMissingText) return false;
  return true;
}

/**
 * The deterministic federal publisher does not own SCOTUS. The official
 * supremecourt.gov pipeline does, and the court registry leaves `scotus` unverified
 * on purpose. Selecting those rows here only records `unverified_court_record` holds.
 */
export function federalPublicationIncludesCourt(providerCourtId: string | null | undefined): boolean {
  return (providerCourtId ?? "").trim().toLowerCase() !== "scotus";
}
