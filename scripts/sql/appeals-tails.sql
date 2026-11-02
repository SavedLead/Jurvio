-- One batch of closing text (last ~1,600 characters of the main opinion before any
-- separate opinion) for appeals cases that have a linked panel judge and no outcome yet,
-- after :'after' (keyset on case id). Read-only export for the appeals backfill.
COPY (
  SELECT s.case_id,
    right(coalesce(left(dc.content_text, strpos(dc.content_text, substring(dc.content_text FROM
      '(?:[A-Z][A-Za-z''’-]+, (?:Chief |Senior )?(?:Circuit|District) Judge, (?:concurring|dissenting))')) - 1), dc.content_text), 1600)
  FROM (
    SELECT DISTINCT seat.case_id FROM appeals_panel_seat seat
    WHERE seat.judge_id IS NOT NULL AND seat.case_id > :'after'::uuid
      AND NOT EXISTS (SELECT 1 FROM appeals_case_outcome o WHERE o.case_id = seat.case_id)
    ORDER BY seat.case_id LIMIT :batch
  ) s
  JOIN LATERAL (
    SELECT o.document_id FROM opinion_cluster c JOIN judicial_opinion o ON o.cluster_id = c.id
    WHERE c.case_id = s.case_id AND o.document_id IS NOT NULL
    ORDER BY c.date_filed DESC NULLS LAST, (o.opinion_type ~* '(lead|majority|combined)') DESC, o.id LIMIT 1
  ) op ON true
  JOIN document d ON d.id = op.document_id AND d.publication = 'published'
  JOIN document_content dc ON dc.document_id = d.id
  ORDER BY s.case_id
) TO STDOUT;
