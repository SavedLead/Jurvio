import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;
type Raw = Record<string, string | number | boolean | null>;

export interface CaseIngestionReport {
  generatedAt: string;
  totals: { candidates: number; live: number; blocked: number; ready: number };
  actions: Array<{ key: string; label: string; nextStep: string; count: number; projectedLive: number; blocking: boolean }>;
  candidates: Array<{
    id: string; caption: string; docket: string; filedOn: string; live: boolean;
    blocker: string | null; nextStep: string; casePublicId: string | null;
  }>;
  cases: Array<{
    id: string; publicId: string; caption: string; docket: string; decidedOn: string | null;
    live: boolean; blocker: string | null; nextStep: string;
    enrichment: Record<"A" | "B" | "C" | "D" | "E" | "F" | "G", boolean>;
    voteBreakdown: string | null;
  }>;
}

const n = (value: unknown) => Number(value ?? 0);
const b = (value: unknown) => value === true || value === "true";

function candidateBlocker(row: Raw) {
  if (b(row.live)) return null;
  if (!row.case_public_id) {
    return String(row.reviewer_notes ?? "").toLowerCase().includes("ambiguous")
      ? "Ambiguous canonical case match"
      : "No canonical case match";
  }
  if (!b(row.has_text)) return "Readable opinion text is missing";
  return "Unified publication has not completed";
}

export async function getCaseIngestionReport(sql: Sql, limit = 300): Promise<CaseIngestionReport> {
  const safeLimit = Math.min(Math.max(limit, 1), 500);
  const [caseRows, candidateRows, totals] = await Promise.all([
    sql<Raw[]>`
      SELECT c.id::text, c.public_id, c.caption, c.docket_number, c.decided_on::text,
        (c.publication = 'published' AND COALESCE(pd.displayable, false)) AS live,
        EXISTS (
          SELECT 1 FROM official_opinion_candidate oc
          WHERE lower(regexp_replace(oc.docket_number, '[^a-zA-Z0-9]', '', 'g'))
            = lower(regexp_replace(c.docket_number, '[^a-zA-Z0-9]', '', 'g'))
            AND oc.filed_on = c.decided_on
        ) AS has_candidate,
        EXISTS (
          SELECT 1 FROM document d JOIN document_content dc ON dc.document_id = d.id
          WHERE d.case_id = c.id AND dc.word_count > 0
        ) AS has_text,
        COALESCE(e.background_summary IS NOT NULL AND e.background_source_url IS NOT NULL
          AND e.significance_summary IS NOT NULL AND e.significance_source_url IS NOT NULL, false) AS a,
        COALESCE(e.question_presented IS NOT NULL AND e.question_source_url IS NOT NULL, false) AS b,
        COALESCE(e.exact_holding IS NOT NULL AND e.holding_source_url IS NOT NULL
          AND e.exact_disposition IS NOT NULL AND e.disposition_source_url IS NOT NULL, false) AS c,
        COALESCE(e.completeness->>'lineupChecked' = 'true'
          AND e.completeness->>'opinionMetadataV2' = 'true', false) AS d,
        EXISTS (SELECT 1 FROM docket_entry de WHERE de.case_id = c.id) AS e,
        COALESCE(e.syllabus_text IS NOT NULL AND e.syllabus_source_url IS NOT NULL, false) AS f,
        EXISTS (
          SELECT 1 FROM document d WHERE d.case_id = c.id
            AND d.document_type::text IN ('brief', 'transcript', 'audio', 'order', 'syllabus')
        ) AS g,
        NULLIF(e.decision_lineup->'voteBreakdown'->>'label', '') AS vote_breakdown
      FROM legal_case c
      JOIN court court_record ON court_record.id = c.court_id
      LEFT JOIN scotus_case_enrichment e ON e.case_id = c.id
      LEFT JOIN LATERAL (
        SELECT displayable FROM publication_decision
        WHERE object_type = 'legal_case' AND object_id = c.id
        ORDER BY decided_at DESC, id DESC LIMIT 1
      ) pd ON true
      WHERE lower(court_record.provider_court_id) = 'scotus'
      ORDER BY live, c.decided_on DESC NULLS LAST, c.caption
      LIMIT ${safeLimit}
    `,
    sql<Raw[]>`
      SELECT oc.id::text, oc.case_name, oc.docket_number, oc.filed_on::text,
        oc.reviewer_notes, matched.public_id AS case_public_id,
        COALESCE(matched.live, false) AS live, COALESCE(matched.has_text, false) AS has_text
      FROM official_opinion_candidate oc
      LEFT JOIN LATERAL (
        SELECT c.public_id,
          (c.publication = 'published' AND COALESCE(pd.displayable, false)) AS live,
          EXISTS (
            SELECT 1 FROM document d JOIN document_content dc ON dc.document_id = d.id
            WHERE d.case_id = c.id AND dc.word_count > 0
          ) AS has_text
        FROM legal_case c
        JOIN court court_record ON court_record.id = c.court_id
        LEFT JOIN LATERAL (
          SELECT displayable FROM publication_decision
          WHERE object_type = 'legal_case' AND object_id = c.id
          ORDER BY decided_at DESC, id DESC LIMIT 1
        ) pd ON true
        WHERE lower(court_record.provider_court_id) = 'scotus'
          AND lower(regexp_replace(c.docket_number, '[^a-zA-Z0-9]', '', 'g'))
            = lower(regexp_replace(oc.docket_number, '[^a-zA-Z0-9]', '', 'g'))
          AND c.decided_on = oc.filed_on
        ORDER BY c.updated_at DESC LIMIT 1
      ) matched ON true
      ORDER BY live, oc.filed_on DESC, oc.case_name
      LIMIT ${safeLimit}
    `,
    sql<Raw[]>`
      SELECT
        (SELECT count(*) FROM official_opinion_candidate) AS candidates,
        count(*) FILTER (WHERE c.publication = 'published' AND COALESCE(pd.displayable, false)) AS live
      FROM legal_case c
      JOIN court court_record ON court_record.id = c.court_id
      LEFT JOIN LATERAL (
        SELECT displayable FROM publication_decision
        WHERE object_type = 'legal_case' AND object_id = c.id
        ORDER BY decided_at DESC, id DESC LIMIT 1
      ) pd ON true
      WHERE lower(court_record.provider_court_id) = 'scotus'
    `,
  ]);

  const candidates = candidateRows.map((row) => {
    const blocker = candidateBlocker(row);
    const nextStep = !blocker ? "No action required"
      : blocker === "Readable opinion text is missing" ? "Extract readable text, then rerun unified publication"
      : blocker === "Unified publication has not completed" ? "Run unified ingest, enrich, and publish"
      : blocker === "Ambiguous canonical case match" ? "Review docket, date, and caption conflicts"
      : "Match the official candidate to exactly one canonical case";
    return {
      id: String(row.id), caption: String(row.case_name), docket: String(row.docket_number),
      filedOn: String(row.filed_on), live: b(row.live), blocker, nextStep,
      casePublicId: row.case_public_id ? String(row.case_public_id) : null,
    };
  });
  const cases = caseRows.map((row) => {
    const live = b(row.live);
    const blocker = live ? null : !b(row.has_candidate) ? "Official opinion candidate is missing"
      : !b(row.has_text) ? "Readable opinion text is missing" : "Ready for unified publication";
    return {
      id: String(row.id), publicId: String(row.public_id), caption: String(row.caption),
      docket: String(row.docket_number), decidedOn: row.decided_on ? String(row.decided_on) : null,
      live, blocker, nextStep: live ? "No publication action required"
        : blocker === "Official opinion candidate is missing" ? "Ingest the official opinion candidate"
        : blocker === "Readable opinion text is missing" ? "Extract or reconcile readable opinion text"
        : "Run unified ingest, enrich, and publish",
      enrichment: { A: b(row.a), B: b(row.b), C: b(row.c), D: b(row.d), E: b(row.e), F: b(row.f), G: b(row.g) },
      voteBreakdown: row.vote_breakdown ? String(row.vote_breakdown) : null,
    };
  });
  const live = n(totals[0]?.live);
  const definitions = [
    ["publish", "Run unified publication", "Run unified ingest, enrich, and publish", "Unified publication has not completed", true],
    ["text", "Restore readable text", "Extract or reconcile text, then rerun publication", "Readable opinion text is missing", true],
    ["match", "Resolve canonical matches", "Match docket, date, and caption to one case", "No canonical case match", true],
    ["ambiguous", "Resolve ambiguous matches", "Review docket, date, and caption conflicts", "Ambiguous canonical case match", true],
  ] as const;
  const actions: CaseIngestionReport["actions"] = definitions.map(([key, label, nextStep, blocker, blocking]) => {
    const count = candidates.filter((candidate) => candidate.blocker === blocker).length;
    return { key, label, nextStep, count, projectedLive: live + count, blocking };
  }).filter((action) => action.count > 0);
  const optionalCount = cases.filter((item) => Object.values(item.enrichment).some((value) => !value)).length;
  if (optionalCount) actions.push({
    key: "optional", label: "Complete optional enrichment",
    nextStep: "Backfill missing A–G material when authoritative sources exist",
    count: optionalCount, projectedLive: live, blocking: false,
  });
  return {
    generatedAt: new Date().toISOString(),
    totals: {
      candidates: n(totals[0]?.candidates), live,
      blocked: candidates.filter((item) => !item.live && item.blocker).length,
      ready: candidates.filter((item) => item.blocker === "Unified publication has not completed").length,
    },
    actions, candidates, cases,
  };
}
