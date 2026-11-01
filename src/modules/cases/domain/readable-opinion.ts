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
