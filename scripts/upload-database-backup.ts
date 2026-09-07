/**
 * Copies a local `pg_dump | gzip` file to encrypted off-Droplet object storage.
 *
 * The readiness checklist's known boundary: "The local pre-migration dump
 * retained on the Droplet supports release rollback but is not disaster
 * recovery. A separate encrypted backup location and a successful restore test
 * are required before public launch." This job is the first half of closing it
 * (`verify-database-backup.ts` is the second).
 *
 * Reads the dump, writes nothing locally, and never logs the encryption key or
 * storage credentials. Exits non-zero on any failure so the nightly workflow
 * goes red instead of silently keeping only an on-box copy.
 *
 * Usage:
 *   node jobs/upload-database-backup.mjs --file /opt/jurvio/backups/jurvio-<stamp>.sql.gz
 *   node jobs/upload-database-backup.mjs --file <path> --prefix database --keep 14
 */
import { stat } from "node:fs/promises";
import {
  backupObjectKey,
  OffsiteBackupStore,
  resolveOffsiteBackupConfig,
} from "@/modules/operations/application/offsite-backup";

function arg(name: string): string | null {
  const prefixed = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (prefixed) return prefixed.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

async function main() {
  const filePath = arg("file");
  if (!filePath) {
    console.error("--file <path to jurvio-<stamp>.sql.gz> is required");
    process.exit(2);
  }
  const prefix = arg("prefix") ?? "database";
  // Retention on the off-site copy is generous by design: it is the disaster
  // recovery point, not the release-rollback aid the two on-box dumps serve.
  const keep = Math.max(1, Number(arg("keep") ?? "30"));

  const stats = await stat(filePath).catch(() => null);
  if (!stats?.isFile()) {
    console.error(`::error::backup file not found: ${filePath}`);
    process.exit(1);
  }
  if (stats.size === 0) {
    console.error(`::error::refusing to upload an empty backup file: ${filePath}`);
    process.exit(1);
  }

  const store = new OffsiteBackupStore(resolveOffsiteBackupConfig(process.env));
  const objectKey = backupObjectKey(filePath, prefix);

  // Backups are immutable: the object key carries the dump's own timestamp, so
  // a re-run for the same dump must not silently rewrite what is already stored.
  if (await store.exists(objectKey)) {
    console.log(JSON.stringify({ report: "offsite-backup", objectKey, skipped: "already-stored" }));
    return;
  }

  const started = Date.now();
  const result = await store.uploadEncrypted(filePath, objectKey);
  const retained = await store.list(`${prefix}/`);

  console.log(
    JSON.stringify({
      report: "offsite-backup",
      objectKey: result.objectKey,
      plaintextBytes: result.plaintextBytes,
      uploadedBytes: result.uploadedBytes,
      parts: result.parts,
      plaintextSha256: result.plaintextSha256,
      elapsedSeconds: Math.round((Date.now() - started) / 1000),
      objectsRetained: retained.length,
      retentionTarget: keep,
      // Pruning old off-site copies is deliberately NOT automated here. A bug in
      // a nightly deleter is how a backup history disappears; the count is
      // reported so retention stays an observed, human decision.
      retentionNote: retained.length > keep ? "above target — prune manually" : "within target",
    }),
  );
}

main().catch((error) => {
  console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
