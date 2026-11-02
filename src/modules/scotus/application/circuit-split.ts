import type postgres from "postgres";
import { citationDocumentVisibleSql } from "@/modules/citations/application/citation-edges";
import { readCircuitSplit, type CircuitSplitSentence } from "@/modules/scotus/domain/circuit-split";

type Sql = ReturnType<typeof postgres>;

export interface CaseCircuitSplit { sentences: CircuitSplitSentence[]; source: "opinion"; documentPublicId: string | null }

const cache = new Map<string, { at: number; value: CaseCircuitSplit | null }>();

/** Split sentences from the Court's opinion (first 60,000 characters). Cached 30 minutes; null on timeout. The page falls back to the question presented it already has. */
export async function loadCaseCircuitSplit(sql: Sql, casePublicId: string, opinionDocumentPublicId: string | null): Promise<CaseCircuitSplit | null> {
  const key = `${casePublicId}:${opinionDocumentPublicId ?? ""}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.value;
  let value: CaseCircuitSplit | null = null;
  try {
    value = await sql.begin(async (tx) => {
      await tx`SET LOCAL statement_timeout = '2000ms'`;
      if (!opinionDocumentPublicId) return null;
        const [doc] = await tx<Array<{ text: string | null }>>`
          SELECT left(content.content_text, 60000) AS text FROM document d JOIN document_content content ON content.document_id = d.id
          JOIN legal_case lc ON lc.id = d.case_id
          WHERE d.public_id = ${opinionDocumentPublicId} AND lc.public_id = ${casePublicId} AND ${tx.unsafe(citationDocumentVisibleSql("d"))}
        `;
        const sentences = readCircuitSplit(doc?.text);
        return sentences.length ? { sentences, source: "opinion" as const, documentPublicId: opinionDocumentPublicId } : null;
    });
  } catch {
    value = null;
  }
  if (cache.size > 2000) cache.clear();
  cache.set(key, { at: Date.now(), value });
  return value;
}
