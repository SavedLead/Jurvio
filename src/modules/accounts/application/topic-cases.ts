import type { Sql } from "postgres";
import { latestPublicationColumnSql } from "@/modules/publication/application/current-visibility";
import { searchExcludedCaseSql } from "@/modules/publication/domain/search-exclusion";
import { topicMatchSql, type TopicDefinition } from "../domain/topics";

export interface TopicCase {
  publicId: string;
  caption: string;
  docketNumber: string;
  courtName: string | null;
  natureOfSuit: string | null;
  date: string | null;
}

/**
 * Newest public cases in a topic, walking the published-recency index
 * (legal_case_published_recency_idx) and stopping after `limit` matches.
 * Bounded by a short statement timeout: a slow walk shows an empty list
 * rather than holding a web connection.
 */
export async function listTopicCases(sql: Sql, topic: TopicDefinition, limit = 30): Promise<TopicCase[] | null> {
  try {
    return await sql.begin(async (tx) => {
      const db = tx as unknown as Sql;
      await db`SET LOCAL statement_timeout = '4s'`;
      return db<TopicCase[]>`
        SELECT legal_case.public_id AS "publicId", legal_case.caption, legal_case.docket_number AS "docketNumber",
          court.name AS "courtName", legal_case.nature_of_suit_code AS "natureOfSuit",
          COALESCE(legal_case.decided_on, legal_case.filed_on)::text AS date
        FROM legal_case
        JOIN court ON court.id = legal_case.court_id
        WHERE legal_case.publication = 'published'
          AND ${db.unsafe(topicMatchSql(topic, "legal_case.nature_of_suit_code"))}
          AND ${db.unsafe(latestPublicationColumnSql("displayable", "legal_case", "legal_case.id"))}
          AND NOT ${db.unsafe(searchExcludedCaseSql("legal_case"))}
        ORDER BY COALESCE(legal_case.decided_on, legal_case.filed_on) DESC NULLS LAST, legal_case.caption, legal_case.id
        LIMIT ${Math.min(Math.max(limit, 1), 100)}`;
    });
  } catch (error) {
    if (error instanceof Error && /statement timeout|canceling statement/i.test(error.message)) return null;
    throw error;
  }
}
