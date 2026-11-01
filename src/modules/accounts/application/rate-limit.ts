import type { Sql } from "postgres";
import { hashIdentifier } from "../domain/tokens";

export const SIGNIN_LIMITS = {
  signin_email: { max: 5, windowMinutes: 15 },
  signin_ip: { max: 20, windowMinutes: 60 },
  waitlist_email: { max: 10, windowMinutes: 15 },
  waitlist_ip: { max: 30, windowMinutes: 60 },
} as const;
export type RateLimitBucket = keyof typeof SIGNIN_LIMITS;

/** Counts one hit in a fixed window and returns whether it is still allowed. */
export async function hitRateLimit(sql: Sql, bucket: RateLimitBucket, rawKey: string): Promise<boolean> {
  const { max, windowMinutes } = SIGNIN_LIMITS[bucket];
  const keyHash = hashIdentifier(bucket, rawKey);
  const [row] = await sql<{ hits: number }[]>`
    INSERT INTO auth_rate_limit (bucket, key_hash, window_started_at, hits)
    VALUES (${bucket}, ${keyHash}, now(), 1)
    ON CONFLICT (bucket, key_hash) DO UPDATE SET
      hits = CASE WHEN auth_rate_limit.window_started_at < now() - make_interval(mins => ${windowMinutes}) THEN 1
                  ELSE auth_rate_limit.hits + 1 END,
      window_started_at = CASE WHEN auth_rate_limit.window_started_at < now() - make_interval(mins => ${windowMinutes}) THEN now()
                  ELSE auth_rate_limit.window_started_at END
    RETURNING hits`;
  return (row?.hits ?? Number.POSITIVE_INFINITY) <= max;
}
