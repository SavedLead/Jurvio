import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

/** Staff and test accounts are left out of the counts. Their addresses are never selected. */
const OUTSIDE = `u.email NOT LIKE '%@jurvio.com' AND u.email NOT LIKE '%example%' AND u.email NOT LIKE '%cleanyourname%'`;
const PAID = `s.plan IN ('plus', 'pro', 'team') AND s.status IN ('active', 'trialing', 'past_due')`;

export interface AlertSubscriberReport {
  subscribers: number;
  free: number;
  paid: number;
  follows: Array<{ followType: string; follows: number; subscribers: number }>;
  emergencyFeeds: Array<{ feed: string; follows: number }>;
  topCases: Array<{ publicId: string; caption: string; docketNumber: string; follows: number }>;
  topJudges: Array<{ label: string; follows: number }>;
  topTopics: Array<{ label: string; follows: number }>;
  topParties: Array<{ label: string; follows: number }>;
}

export async function getAlertSubscriberReport(sql: Sql): Promise<AlertSubscriberReport> {
  return sql.begin(async (tx) => {
    await tx`SET LOCAL statement_timeout = '8s'`;
    const [totals] = await tx<{ subscribers: number; free: number; paid: number }[]>`
      WITH subscribers AS (
        SELECT u.id,
          CASE WHEN ${tx.unsafe(PAID)} THEN 'paid' ELSE 'free' END AS tier
        FROM app_user u
        LEFT JOIN account_subscription s ON s.user_id = u.id
        WHERE ${tx.unsafe(OUTSIDE)}
          AND (
            EXISTS (SELECT 1 FROM case_follow f WHERE f.user_id = u.id)
            OR EXISTS (SELECT 1 FROM entity_follow f WHERE f.user_id = u.id)
          )
      )
      SELECT count(*)::int AS subscribers,
        count(*) FILTER (WHERE tier = 'free')::int AS free,
        count(*) FILTER (WHERE tier = 'paid')::int AS paid
      FROM subscribers`;
    const follows = await tx<{ followType: string; follows: number; subscribers: number }[]>`
      SELECT 'case' AS "followType", count(*)::int AS follows, count(DISTINCT f.user_id)::int AS subscribers
      FROM case_follow f JOIN app_user u ON u.id = f.user_id
      WHERE ${tx.unsafe(OUTSIDE)}
      UNION ALL
      SELECT f.kind, count(*)::int, count(DISTINCT f.user_id)::int
      FROM entity_follow f JOIN app_user u ON u.id = f.user_id
      WHERE ${tx.unsafe(OUTSIDE)}
      GROUP BY f.kind
      ORDER BY 1`;
    const emergencyFeeds = await tx<{ feed: string; follows: number }[]>`
      SELECT f.target_key AS feed, count(*)::int AS follows
      FROM entity_follow f JOIN app_user u ON u.id = f.user_id
      WHERE f.kind = 'emergency' AND ${tx.unsafe(OUTSIDE)}
      GROUP BY f.target_key ORDER BY follows DESC, feed`;
    const topCases = await tx<{ publicId: string; caption: string; docketNumber: string; follows: number }[]>`
      SELECT c.public_id AS "publicId", left(c.caption, 80) AS caption, c.docket_number AS "docketNumber", count(*)::int AS follows
      FROM case_follow f
      JOIN legal_case c ON c.id = f.case_id
      JOIN app_user u ON u.id = f.user_id
      WHERE ${tx.unsafe(OUTSIDE)}
      GROUP BY c.public_id, c.caption, c.docket_number
      ORDER BY follows DESC, c.public_id
      LIMIT 15`;
    const topOf = async (kind: string) => tx<{ label: string; follows: number }[]>`
      SELECT coalesce(nullif(f.label, ''), f.target_key) AS label, count(*)::int AS follows
      FROM entity_follow f JOIN app_user u ON u.id = f.user_id
      WHERE f.kind = ${kind} AND ${tx.unsafe(OUTSIDE)}
      GROUP BY 1 ORDER BY follows DESC, label LIMIT 15`;
    return {
      subscribers: totals?.subscribers ?? 0,
      free: totals?.free ?? 0,
      paid: totals?.paid ?? 0,
      follows,
      emergencyFeeds,
      topCases,
      topJudges: await topOf("judge"),
      topTopics: await topOf("topic"),
      topParties: await topOf("party"),
    };
  });
}
