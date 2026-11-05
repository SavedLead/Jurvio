/**
 * Read-only: list off-site backup object keys and sizes in jurvio-db-backups.
 *
 *   node list-offsite-backup-keys.mjs --keys database/2026/11/a.enc,database/2026/11/b.enc
 *   node list-offsite-backup-keys.mjs --prefix database/2026/11/
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
  const rawKeys = arg("keys");
  const prefix = arg("prefix");
  if (!rawKeys && !prefix) {
    console.error("provide --keys <csv> and/or --prefix <prefix/>");
    process.exit(2);
  }
  if (prefix && !/^database\/(\d{4}\/\d{2}\/)?$/.test(prefix)) {
    console.error(`::error::refusing unexpected prefix shape: ${prefix}`);
    process.exit(2);
  }

  const target = resolveBackupBucketTarget(process.env, "jurvio-db-backups");
  const store = new OffsiteBackupStore(target);

  const listed = await store.list(prefix ?? "database/");
  const byKey = new Map(listed.map((o) => [o.key, o]));

  const objects = rawKeys
    ? rawKeys.split(",").map((k) => k.trim()).filter(Boolean).map((key) => {
        if (!/^database\/\d{4}\/\d{2}\/jurvio-\d{8}T\d{6}Z\.sql\.gz\.enc$/.test(key)) {
          throw new Error(`refusing unexpected object key shape: ${key}`);
        }
        const hit = byKey.get(key);
        return {
          key,
          present: Boolean(hit),
          sizeBytes: hit?.size ?? null,
          lastModified: hit?.lastModified ?? null,
        };
      })
    : listed.map((o) => ({
        key: o.key,
        present: true,
        sizeBytes: o.size,
        lastModified: o.lastModified,
      }));

  console.log(
    JSON.stringify({
      report: "offsite-backup-keys",
      bucket: target.bucket,
      host: target.host,
      prefix: prefix ?? null,
      listedCount: listed.length,
      objects,
    }),
  );
}

main().catch((error) => {
  console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
