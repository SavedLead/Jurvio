import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  COURTLISTENER_API_BASE_URL: z.string().url().default("https://www.courtlistener.com/api/rest/v4"),
  COURTLISTENER_API_TOKEN: z.string().optional(),
  INGESTION_USER_AGENT: z.string().min(8),
});

let cached: z.infer<typeof schema> | undefined;

export function env() {
  cached ??= schema.parse(process.env);
  return cached;
}
