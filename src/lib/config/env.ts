import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  COURTLISTENER_API_BASE_URL: z.string().url().default("https://www.courtlistener.com/api/rest/v4"),
  COURTLISTENER_API_TOKEN: z.string().optional(),
  INGESTION_USER_AGENT: z.string().min(8),
  SITE_URL: z.string().url().default("https://jurvio.com"),
  CF_ACCESS_TEAM_DOMAIN: z.string().url().optional(),
  CF_ACCESS_AUDIENCE: z.string().min(16).optional(),
  // Public customer authentication (M4 / ADR 0077), via WorkOS AuthKit (OIDC). Separate from the
  // staff Cloudflare Access command center above. All optional: when unset, public accounts are
  // simply unavailable and the public read-only site is unaffected. Read only at runtime; never
  // logged. WORKOS_COOKIE_PASSWORD is the sealed-session secret (>= 32 chars).
  WORKOS_API_KEY: z.string().optional(),
  WORKOS_CLIENT_ID: z.string().optional(),
  WORKOS_REDIRECT_URI: z.string().url().optional(),
  WORKOS_COOKIE_PASSWORD: z.string().min(32).optional(),
  // Pre-launch indexing lockdown switch. Only the literal "true" opens the
  // public site to search-engine indexing; anything else (including unset)
  // keeps the site fully noindex/nofollow. See src/lib/seo/indexing.ts.
  JURVIO_PUBLIC_LAUNCH: z.string().optional(),
  // DigitalOcean Spaces raw-artifact store (S3-compatible). When both the access
  // key and secret are present, raw source artifacts are written immutably to
  // Spaces; otherwise the on-disk store is used. Read only at runtime; never logged.
  JURVIO_SPACES_ACCESS_KEY_ID: z.string().optional(),
  JURVIO_SPACES_SECRET_ACCESS_KEY: z.string().optional(),
  JURVIO_SPACES_BUCKET: z.string().default("jurvio-raw-evidence"),
  JURVIO_SPACES_ENDPOINT: z.string().url().default("https://nyc3.digitaloceanspaces.com"),
  JURVIO_SPACES_REGION: z.string().default("nyc3"),
  // Encrypted off-Droplet database backups. The bucket MUST differ from the raw
  // artifact bucket so a credential or lifecycle mistake on one cannot destroy
  // the other. Credentials fall back to the Spaces keys above when unset; the
  // AES-256 key never does. See src/modules/operations/application/offsite-backup.ts.
  JURVIO_BACKUP_BUCKET: z.string().optional(),
  JURVIO_BACKUP_ENCRYPTION_KEY: z.string().optional(),
  JURVIO_BACKUP_ACCESS_KEY_ID: z.string().optional(),
  JURVIO_BACKUP_SECRET_ACCESS_KEY: z.string().optional(),
  JURVIO_BACKUP_ENDPOINT: z.string().url().optional(),
  JURVIO_BACKUP_REGION: z.string().optional(),
});

let cached: z.infer<typeof schema> | undefined;

export function env() {
  cached ??= schema.parse(process.env);
  return cached;
}
