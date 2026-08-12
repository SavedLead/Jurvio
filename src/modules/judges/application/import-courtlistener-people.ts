import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type postgres from "postgres";
import { parseCsv } from "./import-fjc-judges";
import { normalizeJudgeName } from "../domain/normalize-judge-name";

const execFileAsync = promisify(execFile);
type Sql = ReturnType<typeof postgres>;

// CourtListener free BULK people-db (quarterly CSVs on public S3 — no token, no
// rate limit). Enriches the Article I bench (magistrate + bankruptcy) that
// Wikidata does not cover: a CourtListener person id per matched judge, plus a
// free.law portrait where the Free Law Project has one. Matched by exact
// normalized name, and only when unambiguous on both sides — never overwriting an
// existing photo, so a wrong face can never land on the wrong judge.
const BULK = "https://com-courtlistener-storage.s3.amazonaws.com";
const CL_PERSON_BASE = "https://www.courtlistener.com/person";
// Free Law Project judge-pics portrait manifest (an array of {person, path}) and
// the hosted image URL it builds: https://portraits.free.law/v2/{size}/{path}.jpeg
// (see freelawproject/judge-pics judge_pics/search.py). The manifest — keyed by
// CourtListener person id — is the source of truth for which judges actually have
// a portrait, rather than CourtListener's own has_photo flag.
const PORTRAIT_MANIFEST =
  "https://raw.githubusercontent.com/freelawproject/judge-pics/main/judge_pics/data/people.json";
const PORTRAIT_BASE = "https://portraits.free.law/v2/256";

async function fetchPortraitManifest(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const response = await fetch(PORTRAIT_MANIFEST, {
      headers: { "user-agent": "Jurvio judge enrichment/1.0" }, signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return map;
    const entries = (await response.json()) as Array<{ person?: number | string; path?: string }>;
    for (const entry of entries) {
      const person = entry.person === undefined || entry.person === null ? "" : String(entry.person).trim();
      const path = (entry.path ?? "").trim();
      if (person && path && !map.has(person)) map.set(person, path);
    }
  } catch {
    // A missing/unreachable manifest simply means no portraits this run — the
    // person-id enrichment below is unaffected.
  }
  return map;
}

async function latestBulkKey(prefix: string): Promise<string> {
  const response = await fetch(`${BULK}/?list-type=2&prefix=bulk-data/${prefix}`, {
    headers: { "user-agent": "Jurvio judge enrichment/1.0" }, signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`bulk listing failed (${response.status}) for ${prefix}`);
  const xml = await response.text();
  const keys = [...xml.matchAll(/<Key>(bulk-data\/[^<]+\.csv\.bz2)<\/Key>/g)]
    .map((match) => match[1] ?? "").filter(Boolean);
  keys.sort();
  const latest = keys[keys.length - 1];
  if (!latest) throw new Error(`no bulk file found for prefix ${prefix}`);
  return latest;
}

// The runtime image ships bzip2 (Dockerfile: apk add bzip2). Stream the file to a
// temp path and decompress with the system tool rather than pulling a JS codec.
async function fetchCsvBz2(key: string): Promise<string> {
  const response = await fetch(`${BULK}/${key}`, {
    headers: { "user-agent": "Jurvio judge enrichment/1.0" }, signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw new Error(`bulk download failed (${response.status}) for ${key}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const directory = await mkdtemp(join(tmpdir(), "cl-bulk-"));
  const file = join(directory, "data.csv.bz2");
  try {
    await writeFile(file, buffer);
    const { stdout } = await execFileAsync("bzip2", ["-dc", file], { maxBuffer: 1024 * 1024 * 1024 });
    return stdout;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function displayName(row: Record<string, string>): string {
  return [row.name_first, row.name_middle, row.name_last, row.name_suffix]
    .map((part) => (part ?? "").trim()).filter(Boolean).join(" ");
}

// Even with the manifest as the source of truth, every portrait is proven to
// resolve before it is written to (or kept on) a judge — a belt-and-suspenders
// guard against a stale manifest path or a moved image. A HEAD is tried first;
// some CDNs answer HEAD with 405/501/403, so a 1-byte ranged GET is the fallback.
// Only a 2xx image response counts as resolved — anything else (404, network
// error, non-image) is treated as absent so a broken URL can never land on a
// public judge page.
async function portraitResolves(url: string): Promise<boolean> {
  const looksImage = (response: Response): boolean =>
    response.ok && (response.headers.get("content-type") ?? "").toLowerCase().startsWith("image/");
  try {
    const head = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(20_000) });
    if (looksImage(head)) return true;
    if (head.status !== 405 && head.status !== 501 && head.status !== 403) return false;
  } catch {
    // fall through to the ranged GET
  }
  try {
    const ranged = await fetch(url, { headers: { range: "bytes=0-0" }, signal: AbortSignal.timeout(20_000) });
    return looksImage(ranged);
  } catch {
    return false;
  }
}

export async function importCourtListenerPeople(sql: Sql): Promise<{
  people: number; articleIPeople: number; manifestPortraits: number; photosChecked: number;
  photosSet: number; photosHealed: number; factsSet: number; ambiguous: number;
}> {
  const [peopleKey, positionsKey] = await Promise.all([
    latestBulkKey("people-db-people"), latestBulkKey("people-db-positions"),
  ]);
  const [peopleCsv, positionsCsv, portraitByPerson] = await Promise.all([
    fetchCsvBz2(peopleKey), fetchCsvBz2(positionsKey), fetchPortraitManifest(),
  ]);
  const people = parseCsv(peopleCsv);
  const positions = parseCsv(positionsCsv);

  const personById = new Map<string, Record<string, string>>();
  for (const person of people) {
    const id = (person.id ?? "").trim();
    if (id) personById.set(id, person);
  }

  // Article I judicial person ids: a magistrate position (position_type 'mag') or
  // any position in a bankruptcy court (CourtListener court_id ends in 'b').
  const articleI = new Set<string>();
  for (const position of positions) {
    const type = (position.position_type ?? "").trim().toLowerCase();
    const court = (position.court_id ?? "").trim().toLowerCase();
    if (type === "mag" || /b$/.test(court)) {
      const personId = (position.person_id ?? "").trim();
      if (personId) articleI.add(personId);
    }
  }

  // Normalized name -> CourtListener person, keeping only names that are unique on
  // the CourtListener side. The portrait path (if the manifest has one for this
  // person) rides along so a photo can be set without a second lookup.
  const byName = new Map<string, { id: string; slug: string; portraitPath: string | null; count: number }>();
  for (const personId of articleI) {
    const person = personById.get(personId);
    if (!person) continue;
    const key = normalizeJudgeName(displayName(person));
    if (!key) continue;
    const existing = byName.get(key);
    if (existing) existing.count += 1;
    else byName.set(key, {
      id: personId, slug: (person.slug ?? "").trim(),
      portraitPath: portraitByPerson.get(personId) ?? null, count: 1,
    });
  }

  let photosChecked = 0, photosSet = 0, factsSet = 0, ambiguous = 0;
  for (const [key, entry] of byName) {
    if (entry.count !== 1) { ambiguous += 1; continue; }
    // Require the name to be unique among OUR roster judges too.
    const matched = await sql<{ id: string; photoUrl: string | null }[]>`
      SELECT id, photo_url AS "photoUrl" FROM judge
      WHERE normalized_name = ${key} AND (fjc_nid IS NOT NULL OR brmag_id IS NOT NULL)
      LIMIT 2
    `;
    if (matched.length !== 1) continue;
    const judge = matched[0]!;
    const personUrl = `${CL_PERSON_BASE}/${entry.id}/${entry.slug || "judge"}/`;
    await sql`
      INSERT INTO judge_profile_fact (judge_id, fact_type, value_json, source_system, source_url, confidence)
      VALUES (${judge.id}, 'courtlistener_person_id', ${sql.json(entry.id)}, 'courtlistener', ${personUrl}, 0.9)
      ON CONFLICT DO NOTHING
    `;
    factsSet += 1;
    if (entry.portraitPath && judge.photoUrl === null) {
      const photoUrl = `${PORTRAIT_BASE}/${entry.portraitPath}.jpeg`;
      photosChecked += 1;
      if (await portraitResolves(photoUrl)) {
        const updated = await sql`
          UPDATE judge SET photo_url = ${photoUrl}, photo_source_url = ${personUrl}, updated_at = now()
          WHERE id = ${judge.id} AND photo_url IS NULL
          RETURNING id
        `;
        photosSet += updated.length;
      }
    }
  }

  // Self-heal: re-validate every free.law portrait already on the roster (these
  // are only ever written by this lane) and clear any that no longer resolve, so
  // a stale or wrong URL cannot linger on a public page. Cheap — only this lane's
  // own photos, a handful of rows.
  let photosHealed = 0;
  const existing = await sql<{ id: string; photoUrl: string }[]>`
    SELECT id, photo_url AS "photoUrl" FROM judge WHERE photo_url LIKE 'https://portraits.free.law/%'
  `;
  for (const row of existing) {
    if (await portraitResolves(row.photoUrl)) continue;
    await sql`
      UPDATE judge SET photo_url = NULL, photo_source_url = NULL, updated_at = now()
      WHERE id = ${row.id} AND photo_url = ${row.photoUrl}
    `;
    photosHealed += 1;
  }

  return {
    people: people.length, articleIPeople: articleI.size, manifestPortraits: portraitByPerson.size,
    photosChecked, photosSet, photosHealed, factsSet, ambiguous,
  };
}
