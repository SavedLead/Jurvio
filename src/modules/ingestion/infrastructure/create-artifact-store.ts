import type { ArtifactStore } from "../application/artifact-store";
import { LocalArtifactStore } from "./local-artifact-store";
import { SpacesArtifactStore } from "./spaces-artifact-store";

/**
 * Selects the raw-artifact store from runtime configuration.
 *
 * When DigitalOcean Spaces credentials are present in the environment, raw
 * artifacts are written immutably to Spaces (bucket `jurvio-raw-evidence` at
 * nyc3 by default). When they are absent (local dev, CI, or a box not yet
 * configured), it falls back to the on-disk store so ingestion never breaks —
 * the switch is purely a matter of whether the credentials are set. Secrets are
 * read only at call time and never logged.
 *
 * Canonical env vars (populated from GitHub's production environment at deploy):
 *   JURVIO_SPACES_ACCESS_KEY_ID, JURVIO_SPACES_SECRET_ACCESS_KEY  (required for Spaces)
 *   JURVIO_SPACES_BUCKET    (default "jurvio-raw-evidence")
 *   JURVIO_SPACES_ENDPOINT  (default "https://nyc3.digitaloceanspaces.com")
 *   JURVIO_SPACES_REGION    (default derived from the endpoint host, e.g. "nyc3")
 */
export function createArtifactStore(opts: {
  localRoot: string;
  env?: Record<string, string | undefined>;
}): ArtifactStore {
  const e = opts.env ?? process.env;
  const accessKeyId = e.JURVIO_SPACES_ACCESS_KEY_ID;
  const secretAccessKey = e.JURVIO_SPACES_SECRET_ACCESS_KEY;
  if (accessKeyId && secretAccessKey) {
    const bucket = e.JURVIO_SPACES_BUCKET ?? "jurvio-raw-evidence";
    const endpoint = e.JURVIO_SPACES_ENDPOINT ?? "https://nyc3.digitaloceanspaces.com";
    const host = new URL(endpoint).host;
    const region = e.JURVIO_SPACES_REGION ?? host.split(".")[0] ?? "nyc3";
    return new SpacesArtifactStore({ bucket, region, host, accessKeyId, secretAccessKey });
  }
  // Fail loud in production. Silently falling back to on-disk storage is exactly
  // how the ingestion box filled to 100% on 2026-08-16: the scheduler workers were
  // missing their Spaces credentials, so ~130 GB of source PDFs were written to the
  // local volume instead of Spaces and nobody was alerted until the disk was full
  // and postgres/workers wedged. In production we refuse the local fallback so the
  // misconfiguration surfaces immediately at startup. A maintenance job that
  // genuinely wants on-disk storage can opt in with JURVIO_ALLOW_LOCAL_ARTIFACT_STORE=1.
  if (e.NODE_ENV === "production" && e.JURVIO_ALLOW_LOCAL_ARTIFACT_STORE !== "1") {
    throw new Error(
      "createArtifactStore: Spaces object storage is required in production but its " +
        "credentials (JURVIO_SPACES_ACCESS_KEY_ID / JURVIO_SPACES_SECRET_ACCESS_KEY) " +
        "are not set. Refusing to fall back to on-disk storage, which silently fills " +
        "the box. Configure Spaces, or set JURVIO_ALLOW_LOCAL_ARTIFACT_STORE=1 to " +
        "explicitly allow local storage for this process.",
    );
  }
  return new LocalArtifactStore(opts.localRoot);
}

/** True when Spaces object storage is configured (both credential vars present). */
export function spacesConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.JURVIO_SPACES_ACCESS_KEY_ID && env.JURVIO_SPACES_SECRET_ACCESS_KEY);
}

/**
 * Returns the concrete Spaces store (for read-only verification such as HEAD
 * existence checks), or null when Spaces credentials are absent. Uses the same
 * config resolution as {@link createArtifactStore}.
 */
export function createSpacesArtifactStore(
  env: Record<string, string | undefined> = process.env,
): SpacesArtifactStore | null {
  const accessKeyId = env.JURVIO_SPACES_ACCESS_KEY_ID;
  const secretAccessKey = env.JURVIO_SPACES_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) return null;
  const bucket = env.JURVIO_SPACES_BUCKET ?? "jurvio-raw-evidence";
  const endpoint = env.JURVIO_SPACES_ENDPOINT ?? "https://nyc3.digitaloceanspaces.com";
  const host = new URL(endpoint).host;
  const region = env.JURVIO_SPACES_REGION ?? host.split(".")[0] ?? "nyc3";
  return new SpacesArtifactStore({ bucket, region, host, accessKeyId, secretAccessKey });
}
