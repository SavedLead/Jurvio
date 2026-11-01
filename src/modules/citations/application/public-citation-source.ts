/**
 * Is citation key `keyExpr` cited by at least one public opinion (published,
 * displayable case and document, at the document's current content version)?
 * An index probe on document_case_citation(citation_key, document_id,
 * source_content_hash) per key, instead of materializing every visible opinion
 * and all ~5M citation rows on each lane run, which overran the lane's
 * 12-minute kill budget once the database was busy (Nov 1, 2026).
 * `excludeCaseExpr` (optional) skips citations made by that case's own opinions.
 */
export function publicCitationSourceExistsSql(keyExpr: string, excludeCaseExpr?: string): string {
  return `EXISTS (
    SELECT 1 FROM document_case_citation src_ref
    JOIN document src_doc ON src_doc.id=src_ref.document_id
    JOIN legal_case src_case ON src_case.id=src_doc.case_id
    JOIN document_content src_content ON src_content.document_id=src_doc.id AND src_content.content_hash=src_ref.source_content_hash
    WHERE src_ref.citation_key=${keyExpr}
      ${excludeCaseExpr ? `AND src_doc.case_id<>${excludeCaseExpr}` : ''}
      AND src_doc.publication='published' AND src_case.publication='published'
      AND COALESCE(
        (SELECT case_pub.displayable FROM publication_current case_pub
          WHERE case_pub.object_type='legal_case' AND case_pub.object_id=src_case.id),
        (SELECT decision.displayable FROM publication_decision decision
          WHERE decision.object_type='legal_case' AND decision.object_id=src_case.id
          ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1),
        false)
      AND COALESCE(
        (SELECT doc_pub.displayable FROM publication_current doc_pub
          WHERE doc_pub.object_type='document' AND doc_pub.object_id=src_doc.id),
        (SELECT decision.displayable FROM publication_decision decision
          WHERE decision.object_type='document' AND decision.object_id=src_doc.id
          ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1),
        false))`;
}
