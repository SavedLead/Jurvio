/**
 * Restore rehearsal: downloads the newest encrypted off-site database backup,
 * decrypts it, and proves the plaintext is a usable dump.
 *
 * This is the second half of the readiness checklist's known boundary — "a
 * successful restore test [is] required before public launch". It answers three
 * questions the mere existence of an object cannot:
 *   1. does the stored object decrypt and authenticate (GCM tag valid)?
 *   2. is the plaintext an intact gzip stream?
 *   3. does it contain real schema and data, not a zero-row dump?
 *
 * It only READS from object storage and writes to the destination path it is
 * given. It never touches the production database — the actual `psql` load into
 * a throwaway container is done by the calling workflow against the file this
 * job writes.
 *
 * Usage:
 *   node jobs/verify-database-backup.mjs --dest /tmp/restore/jurvio.sql.gz
 *   node jobs/verify-database-backup.mjs --key database/2026/09/jurvio-<stamp>.sql.gz.enc --dest <path>
 */
import { stat } from "node:fs/promises";
import {
  dumpProblems,
  inspectDatabaseDump,
} from "@/modules/operations/application/inspect-database-dump";
import {
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
  // --head-only is the cheap nightly gate: prove a fresh recovery point exists
  // off-site without pulling multiple gigabytes back down every night. The full
  // decrypt-and-inspect rehearsal (no flag) runs on its own weekly schedule.
  const headOnly = process.argv.includes("--head-only");
  const dest = arg("dest");
  if (!dest && !headOnly) {
    console.error("--dest <path to write the decrypted dump> is required (or pass --head-only)");
    process.exit(2);
  }
  const prefix = arg("prefix") ?? "database";
  const store = new OffsiteBackupStore(resolveOffsiteBackupConfig(process.env));

  if (headOnly) {
    const maxAgeHours = Number(arg("max-age-hours") ?? "36");
    const newest = await store.latest(`${prefix}/`);
    if (!newest) {
      console.error(`::error::no off-site backup found under prefix "${prefix}/"`);
      process.exit(1);
    }
    const ageHours = (Date.now() - Date.parse(newest.lastModified)) / 3_600_000;
    const fresh = Number.isFinite(ageHours) && ageHours <= maxAgeHours;
    console.log(
      JSON.stringify({
        report: "offsite-backup-head",
        objectKey: newest.key,
        sizeBytes: newest.size,
        lastModified: newest.lastModified,
        ageHours: Number.isFinite(ageHours) ? Number(ageHours.toFixed(1)) : null,
        maxAgeHours,
        fresh,
      }),
    );
    if (newest.size === 0) {
      console.error(`::error::newest off-site backup ${newest.key} is empty`);
      process.exit(1);
    }
    if (!fresh) {
      console.error(
        `::error::newest off-site backup ${newest.key} is ${ageHours.toFixed(1)}h old ` +
          `(limit ${maxAgeHours}h) — the nightly copy is not running`,
      );
      process.exit(1);
    }
    return;
  }

  if (!dest) {
    console.error("--dest <path to write the decrypted dump> is required");
    process.exit(2);
  }

  const explicitKey = arg("key");
  const target = explicitKey
    ? { key: explicitKey, size: 0, lastModified: "" }
    : await store.latest(`${prefix}/`);
  if (!target) {
    console.error(`::error::no off-site backup found under prefix "${prefix}/". ` +
      "The nightly backup has never successfully uploaded.");
    process.exit(1);
  }

  const started = Date.now();
  const downloaded = await store.downloadDecrypted(target.key, dest);
  const onDisk = await stat(dest);
  const dump = await inspectDatabaseDump(dest);

  // A dump that decrypts but carries no schema or no data is not a recovery
  // point. Fail loudly rather than reporting a green restore test.
  const problems = dumpProblems(dump, onDisk.size);

  const report = {
    report: "offsite-backup-verify",
    objectKey: target.key,
    objectLastModified: target.lastModified || null,
    decryptedBytes: downloaded.bytes,
    plaintextSha256: downloaded.sha256,
    uncompressedBytes: dump.uncompressedBytes,
    createTableStatements: dump.createTableStatements,
    copyStatements: dump.copyStatements,
    elapsedSeconds: Math.round((Date.now() - started) / 1000),
    destination: dest,
    verified: problems.length === 0,
    problems,
  };
  console.log(JSON.stringify(report));

  if (problems.length > 0) {
    for (const problem of problems) console.error(`::error::${problem}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
