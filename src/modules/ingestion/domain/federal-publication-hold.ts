export const MISSING_READABLE_CONTENT_REASON = "missing_readable_content";

/**
 * Reasons the metadata publisher may ignore. A case can be displayable without
 * an opinion, a source checksum, or a verified court row. Sealed text, a
 * collision, a missing caption or docket, and a non-federal court are not here.
 */
export const METADATA_REOPENABLE_REASONS = [
  MISSING_READABLE_CONTENT_REASON,
  "unverified_court_record",
  "missing_source_artifact",
  "missing_source_url",
  "invalid_source_checksum",
  "missing_retrieval_timestamp",
] as const;

const REOPENABLE = new Set<string>(METADATA_REOPENABLE_REASONS);

/**
 * A current-rule hold keeps the case out of the publisher unless metadata
 * publication is on and every recorded reason is one the metadata publisher
 * reopens. A sealed, collision, or identity hold still suppresses. An empty
 * reason list suppresses too. This is the predicate the candidate SQL must match.
 */
export function federalHoldSuppressesCandidate(
  reasons: readonly string[],
  allowMetadataWithoutOpinionText: boolean,
): boolean {
  if (!allowMetadataWithoutOpinionText || reasons.length === 0) return true;
  return reasons.some((reason) => !REOPENABLE.has(reason));
}

/** SQL boolean: the hold's reasons are a non-empty subset of the metadata waivers. */
export function metadataHoldReopenSql(reasonsColumn = "hold.reasons"): string {
  if (!/^[a-z_][a-z0-9_.]*$/.test(reasonsColumn)) throw new Error("invalid reasons column");
  const list = METADATA_REOPENABLE_REASONS.map((reason) => `'${reason}'`).join(", ");
  return `cardinality(${reasonsColumn}) > 0 AND ${reasonsColumn} <@ ARRAY[${list}]::text[]`;
}

/**
 * The deterministic federal publisher does not own SCOTUS. The official
 * supremecourt.gov pipeline does, and the court registry leaves `scotus` unverified
 * on purpose. Selecting those rows here only records `unverified_court_record` holds.
 */
export function federalPublicationIncludesCourt(providerCourtId: string | null | undefined): boolean {
  return (providerCourtId ?? "").trim().toLowerCase() !== "scotus";
}
