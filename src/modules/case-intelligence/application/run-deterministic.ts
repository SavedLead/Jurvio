import { createHash } from "node:crypto";
import type postgres from "postgres";
import { deriveDismissalAmendmentAnswers, type EvidenceEvent } from "../domain/deterministic";

type Sql = ReturnType<typeof postgres>;

type CandidateRow = {
  caseId: string;
  eventId: string;
  occurredOn: string;
  eventType: string;
  description: string;
  sourceArtifactId: string | null;
  docketEntryId: string | null;
  payload: Record<string, unknown>;
};

export async function runDeterministicCaseIntelligence(sql: Sql, options: { limit?: number; asOf?: string } = {}) {
  const limit = Math.min(Math.max(options.limit ?? 500, 1), 5_000);
  const asOf = options.asOf ?? new Date().toISOString().slice(0, 10);
  const [run] = await sql<{ id: string }[]>`
    INSERT INTO case_intelligence_run (run_type, rule_version)
    VALUES ('deterministic', 'dismissal-amendment-v1') RETURNING id
  `;
  try {
    const candidates = await sql<CandidateRow[]>`
      WITH candidate_cases AS (
        SELECT DISTINCT case_id FROM docket_entry
        WHERE description ~* '(dismiss.{0,80}(without prejudice|leave to amend)|amended complaint)'
        ORDER BY case_id LIMIT ${limit}
      )
      SELECT d.case_id AS "caseId", d.id::text AS "eventId", d.filed_on::text AS "occurredOn",
        COALESCE(d.entry_type, 'docket_entry') AS "eventType", d.description,
        d.source_artifact_id::text AS "sourceArtifactId", d.id::text AS "docketEntryId",
        '{}'::jsonb AS payload
      FROM docket_entry d JOIN candidate_cases c ON c.case_id = d.case_id WHERE d.filed_on IS NOT NULL
      UNION ALL
      SELECT e.case_id AS "caseId", e.id::text AS "eventId", e.occurred_on::text AS "occurredOn",
        e.event_type AS "eventType", COALESCE(e.normalized_payload->>'description', e.event_type) AS description,
        e.source_artifact_id::text AS "sourceArtifactId", NULL AS "docketEntryId", e.normalized_payload AS payload
      FROM case_status_event e JOIN candidate_cases c ON c.case_id = e.case_id WHERE e.occurred_on IS NOT NULL
      ORDER BY "caseId", "occurredOn", "eventId"
    `;
    const byCase = new Map<string, CandidateRow[]>();
    for (const row of candidates) byCase.set(row.caseId, [...(byCase.get(row.caseId) ?? []), row]);
    let changed = 0;
    for (const [caseId, rows] of byCase) {
      const events: EvidenceEvent[] = rows.map((row) => ({ id: row.eventId, occurredOn: row.occurredOn, eventType: row.eventType, description: row.description, payload: row.payload }));
      const answers = deriveDismissalAmendmentAnswers(events, asOf);
      if (!answers.length) continue;
      await sql.begin(async (tx) => {
        const factIds = new Map<string, string>();
        for (const row of rows) {
          const fingerprint = createHash('sha256').update(`${row.eventId}:${row.eventType}:${row.occurredOn}:${row.description}`).digest('hex');
          const [fact] = await tx<{ id: string }[]>`
            INSERT INTO case_intelligence_fact (case_id, fact_type, value, occurred_on, source_artifact_id, docket_entry_id, extraction_method, extractor_version, confidence, fingerprint)
            VALUES (${caseId}, ${row.eventType}, ${tx.json({ description: row.description, payload: row.payload })}, ${row.occurredOn}, ${row.sourceArtifactId}, ${row.docketEntryId}, 'source_field', 'case-intelligence-v1', 1, ${fingerprint})
            ON CONFLICT (case_id, fingerprint) DO UPDATE SET value = EXCLUDED.value RETURNING id
          `;
          factIds.set(row.eventId, fact.id);
        }
        for (const answer of answers) {
          const hash = createHash('sha256').update(`${answer.answerKey}:${answer.text}:${answer.state}`).digest('hex');
          const current = await tx<{ id: string; answerHash: string }[]>`
            SELECT id, answer_hash AS "answerHash" FROM case_intelligence_answer
            WHERE case_id = ${caseId} AND answer_key = ${answer.answerKey} AND is_current FOR UPDATE
          `;
          if (current[0]?.answerHash === hash) continue;
          await tx`UPDATE case_intelligence_answer SET is_current = false, valid_until = now() WHERE case_id = ${caseId} AND answer_key = ${answer.answerKey} AND is_current`;
          const evidenceFactIds = answer.evidenceIds.map((id) => factIds.get(id)).filter((id): id is string => Boolean(id));
          await tx`
            INSERT INTO case_intelligence_answer (case_id, answer_key, answer_text, answer_state, generation_method, rule_version, confidence, evidence_fact_ids, evidence, answer_hash, as_of, refresh_on)
            VALUES (${caseId}, ${answer.answerKey}, ${answer.text}, ${answer.state}, 'deterministic', ${answer.ruleVersion}, ${answer.confidence}, ${evidenceFactIds}, ${tx.json(answer.evidenceIds)}, ${hash}, ${answer.asOf}, ${answer.refreshOn})
          `;
          changed += 1;
        }
      });
    }
    await sql`UPDATE case_intelligence_run SET status = 'completed', cases_seen = ${byCase.size}, cases_changed = ${changed}, completed_at = now() WHERE id = ${run.id}`;
    return { runId: run.id, casesSeen: byCase.size, answersChanged: changed };
  } catch (error) {
    await sql`UPDATE case_intelligence_run SET status = 'failed', error = ${sql.json({ message: error instanceof Error ? error.message : String(error) })}, completed_at = now() WHERE id = ${run.id}`;
    throw error;
  }
}
