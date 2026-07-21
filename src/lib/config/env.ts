import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  COURTLISTENER_API_BASE_URL: z.string().url().default("https://www.courtlistener.com/api/rest/v4"),
  COURTLISTENER_API_TOKEN: z.string().optional(),
  COURTLISTENER_MIN_REQUEST_INTERVAL_MS: z.coerce.number().int().min(0).default(12_500),
  INGESTION_USER_AGENT: z.string().min(8),
  CF_ACCESS_TEAM_DOMAIN: z.string().url().optional(),
  CF_ACCESS_AUDIENCE: z.string().min(16).optional(),
});

let cached: z.infer<typeof schema> | undefined;

export function env() {
  cached ??= schema.parse(process.env);
  return cached;
}
