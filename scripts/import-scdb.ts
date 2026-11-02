import { readFile, access } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import {
  importJusticeRoster, importMartinQuinn, importScdbRelease, matchScdbToJurvio, refreshScotusAnalytics, type DataFile,
} from "../src/modules/scotus/application/import-scdb";

// Import SCDB (modern + legacy), the FJC-backed justice roster and Martin-Quinn
// scores from the files committed under data/ (see data/README.md), link SCDB
// cases to legal_case rows, and refresh the justice analytics views.
//   pnpm scotus:import-scdb [--data-dir=data] [--skip-legacy] [--mq=data/martin-quinn/2024/justices.csv] [--match-only]
// One connection, an advisory lock, and a statement timeout: a light job, but
// run it on the builder/ingestion side, never on web-01.

const arg = (name: string) => process.argv.find((v) => v.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const flag = (name: string) => process.argv.includes(`--${name}`);
const dataDir = path.resolve(arg("data-dir") ?? "data");

const MODERN = {
  version: "2026 Release 01",
  sourceUrl: "https://scdb.la.psu.edu/data/2026-release-01/",
  justiceFile: "scdb/2026_01/SCDB_2026_01_justiceCentered_Citation.csv.zip",
  docketFile: "scdb/2026_01/SCDB_2026_01_caseCentered_Docket.csv.zip",
};
const LEGACY = {
  version: "Legacy 07",
  sourceUrl: "https://scdb.la.psu.edu/data/scdb-legacy-07/",
  justiceFile: "scdb/legacy_07/SCDB_Legacy_07_justiceCentered_Citation.csv.zip",
};
const MQ = {
  version: "2024 (OT1937-OT2024)",
  sourceUrl: "https://mqscores.wustl.edu/media/2024/justices.csv",
};

async function load(relative: string): Promise<DataFile> {
  const full = path.isAbsolute(relative) ? relative : path.join(dataDir, relative);
  // Stable provenance name ("data/<relative>") whatever the working directory.
  return { path: `data/${path.relative(dataDir, full).split(path.sep).join("/")}`, bytes: await readFile(full) };
}
async function exists(p: string) { try { await access(p); return true; } catch { return false; } }

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const sql = postgres(databaseUrl, { max: 1, onnotice: () => {}, connection: { application_name: "jurvio-scdb-import" } });
try {
  await sql`SELECT set_config('statement_timeout', '600s', false)`;
  const [lock] = await sql<{ locked: boolean }[]>`SELECT pg_try_advisory_lock(hashtext('jurvio-scdb-import-v1')) AS locked`;
  if (!lock?.locked) {
    console.log(JSON.stringify({ scdbImport: "skipped", reason: "advisory lock held" }));
  } else {
    const result: Record<string, unknown> = {};
    if (!flag("match-only")) {
      const rosterFile = await load("scotus/justices.json");
      result.roster = await sql.begin((tx) => importJusticeRoster(tx as never, JSON.parse(rosterFile.bytes.toString("utf8")), rosterFile));
      const modern = { justiceFile: await load(MODERN.justiceFile), docketFile: await load(MODERN.docketFile) };
      result.modern = await sql.begin((tx) => importScdbRelease(tx as never, { era: "modern", version: MODERN.version, sourceUrl: MODERN.sourceUrl, ...modern }));
      if (!flag("skip-legacy")) {
        const legacyFile = await load(LEGACY.justiceFile);
        result.legacy = await sql.begin((tx) => importScdbRelease(tx as never, { era: "legacy", version: LEGACY.version, sourceUrl: LEGACY.sourceUrl, justiceFile: legacyFile }));
      }
      const mqPath = arg("mq") ?? path.join(dataDir, "martin-quinn/2024/justices.csv");
      if (await exists(mqPath)) {
        const mqFile = await load(mqPath);
        result.martinQuinn = await sql.begin((tx) => importMartinQuinn(tx as never, { version: MQ.version, sourceUrl: MQ.sourceUrl, file: mqFile }));
      } else {
        result.martinQuinn = { skipped: `no file at ${path.relative(process.cwd(), mqPath)}` };
      }
    }
    result.match = await matchScdbToJurvio(sql as never);
    await refreshScotusAnalytics(sql as never);
    result.analytics = "refreshed";
    console.log(JSON.stringify(result, null, 1));
  }
} finally {
  await sql.end();
}
