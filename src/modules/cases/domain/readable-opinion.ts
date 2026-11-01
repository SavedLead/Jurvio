/**
 * One rule for "this case has readable opinion text", shared by the case page
 * (opinion-pending banner, robots), the /cases "Readable opinion" badge and
 * filter, and the home page list. A case qualifies only when a published,
 * currently displayable document has non-empty extracted text — exactly what
 * the opinion reader can render. (Before, the listing counted any displayable
 * document, e.g. an official PDF link with no extracted text, so search said
 * "Readable opinion" while the case page said "Opinion text is pending".)
 */
export function readableOpinionExistsSql(caseAlias: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(caseAlias)) throw new Error(`invalid SQL alias: ${caseAlias}`);
  return `EXISTS (
    SELECT 1
    FROM document readable_document
    JOIN document_content readable_content ON readable_content.document_id = readable_document.id
    WHERE readable_document.case_id = ${caseAlias}.id
      AND readable_document.publication = 'published'
      AND (readable_content.word_count > 0 OR readable_content.content_text ~ '\\S')
      AND COALESCE((
        SELECT readable_decision.displayable
        FROM publication_decision readable_decision
        WHERE readable_decision.object_type = 'document'
          AND readable_decision.object_id = readable_document.id
        ORDER BY readable_decision.decided_at DESC, readable_decision.id DESC
        LIMIT 1
      ), false)
  )`;
}

export const TIER_RELEASE_RULE_VERSION = "publication-tiers-v1";
export const INDEXABLE_TIER_RELEASE_REASONS = ["tier1_release", "tier2_release"] as const;

/** Current case decision is an indexable Tier 1 / Tier 2 release (publication-tiers-v1). */
export function tierReleaseIndexableSql(caseAlias: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(caseAlias)) throw new Error(`invalid SQL alias: ${caseAlias}`);
  return `EXISTS (
    SELECT 1 FROM publication_current tier_current
    JOIN publication_decision tier_decision ON tier_decision.id = tier_current.decision_id
    WHERE tier_current.object_type = 'legal_case'
      AND tier_current.object_id = ${caseAlias}.id
      AND tier_decision.indexable
      AND tier_decision.rule_version = '${TIER_RELEASE_RULE_VERSION}'
      AND tier_decision.reason_code IN (${INDEXABLE_TIER_RELEASE_REASONS.map((reason) => `'${reason}'`).join(", ")})
  )`;
}

/**
 * SQL twin of casePageIndexable() for the main /case/<id> URL (sitemaps):
 * readable opinion text or an indexable Tier 1/2 release. Callers add the
 * search-exclusion (sealed) rule themselves.
 */
export function casePageIndexableSql(caseAlias: string): string {
  return `(${readableOpinionExistsSql(caseAlias)} OR ${tierReleaseIndexableSql(caseAlias)})`;
}
