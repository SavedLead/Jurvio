import { closeDb, db } from '@/db/client';
try {
  const sql=db();
  const [counts]=await sql`SELECT
    (SELECT count(*) FROM case_citation_identity) AS case_identities,
    (SELECT count(*) FROM document_case_citation) AS citation_occurrences,
    (SELECT count(*) FROM case_citation_work) AS identity_backlog,
    (SELECT count(*) FROM document_citation_work) AS document_backlog,
    (SELECT count(*) FROM missing_case_citation WHERE state='pending') AS pending_discovery,
    (SELECT count(*) FROM citation_publication_hold) AS publication_holds,
    (SELECT count(*) FROM publication_decision WHERE rule_version='cited-opinion-publication-v1' AND object_type='document') AS published_cited_opinions`;
  const samples=await sql`SELECT DISTINCT c.public_id AS source_case,d.public_id AS source_document,target.public_id AS target_case
    FROM document_case_citation ref JOIN document d ON d.id=ref.document_id JOIN legal_case c ON c.id=d.case_id
    JOIN document_content content ON content.document_id=d.id AND content.content_hash=ref.source_content_hash
    JOIN case_citation_identity i ON i.citation_key=ref.citation_key JOIN legal_case target ON target.id=i.case_id
    WHERE c.id<>target.id AND c.publication='published' AND d.publication='published' AND target.publication='published'
      AND NOT EXISTS(SELECT 1 FROM case_citation_identity other WHERE other.citation_key=i.citation_key AND other.case_id<>i.case_id)
      AND COALESCE((SELECT displayable FROM publication_decision WHERE object_type='legal_case' AND object_id=c.id ORDER BY decided_at DESC,id DESC LIMIT 1),false)
      AND COALESCE((SELECT displayable FROM publication_decision WHERE object_type='legal_case' AND object_id=target.id ORDER BY decided_at DESC,id DESC LIMIT 1),false)
      AND COALESCE((SELECT displayable FROM publication_decision WHERE object_type='document' AND object_id=d.id ORDER BY decided_at DESC,id DESC LIMIT 1),false)
    LIMIT 3`;
  console.log(JSON.stringify({counts,samples},null,2));
} finally { await closeDb(); }
