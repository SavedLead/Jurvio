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
  return new LocalArtifactStore(opts.localRoot);
}

/** True when Spaces object storage is configured (both credential vars present). */
export function spacesConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.JURVIO_SPACES_ACCESS_KEY_ID && env.JURVIO_SPACES_SECRET_ACCESS_KEY);
}
