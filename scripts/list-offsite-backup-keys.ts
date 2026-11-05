/**
 * Read-only: list specific off-site backup object keys and their sizes.
 * Never logs credentials. Used by purge-stale-local-db-dumps-once before deletes.
 *
 *   node list-offsite-backup-keys.mjs --keys database/2026/11/a.enc,database/2026/11/b.enc
 */
import {
  OffsiteBackupStore,
  resolveBackupBucketTarget,
} from "@/modules/operations/application/offsite-backup";

function arg(name: string): string | null {
  const prefixed = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (prefixed) return prefixed.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

async function main() {
  const raw = arg("keys");
  if (!raw) {
    console.error("--keys <comma-separated object keys> is required");
    process.exit(2);
  }
  const keys = raw.split(",").map((k) => k.trim()).filter(Boolean);
  if (keys.length === 0) {
    console.error("--keys must list at least one object key");
    process.exit(2);
  }
  for (const key of keys) {
    if (!/^database\/\d{4}\/\d{2}\/jurvio-\d{8}T\d{6}Z\.sql\.gz\.enc$/.test(key)) {
      console.error(`::error::refusing unexpected object key shape: ${key}`);
      process.exit(2);
    }
  }

  const target = resolveBackupBucketTarget(process.env, "jurvio-db-backups");
  const store = new OffsiteBackupStore(target);
  // List the month prefix once, then project the requested keys.
  const months = [...new Set(keys.map((k) => k.split("/").slice(0, 3).join("/") + "/"))];
  const found = new Map<string, { size: number; lastModified: string }>();
  for (const prefix of months) {
    for (const obj of await store.list(prefix)) {
      found.set(obj.key, { size: obj.size, lastModified: obj.lastModified });
    }
  }

  const objects = keys.map((key) => {
    const hit = found.get(key);
    return {
      key,
      present: Boolean(hit),
      sizeBytes: hit?.size ?? null,
      lastModified: hit?.lastModified ?? null,
    };
  });

  console.log(
    JSON.stringify({
      report: "offsite-backup-keys",
      bucket: target.bucket,
      host: target.host,
      objects,
    }),
  );
}

main().catch((error) => {
  console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
