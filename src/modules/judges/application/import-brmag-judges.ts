import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type postgres from "postgres";
import { createPublicId } from "@/lib/ids/public-id";
import { cleanJudgeDisplayName, normalizeJudgeName } from "../domain/normalize-judge-name";

type Sql = ReturnType<typeof postgres>;

// BR/MAG Judge Database (UVA Law Legal Data Lab) — the consolidated source for
// federal MAGISTRATE and BANKRUPTCY judges, the Article I bench the FJC
// Article III biographical directory does not cover. Published as a single JSON
// array (the CSV endpoint 404s; only JSON + xlsx exist).
export const BRMAG_JSON_URL =
  "https://legaldatalab.law.virginia.edu/brmag-judges/brmag-judges.json";
export const BRMAG_DETAIL_BASE =
  "https://legaldatalab.law.virginia.edu/brmag-judges/detail";
// Optional vendored snapshot fallback (mirrors the FJC importer) so a refresh
// still succeeds if the host cannot reach the source; absent by default.
export const BRMAG_SEED_DIR = process.env.BRMAG_SEED_DIR ?? join(process.cwd(), "db", "seed", "brmag");

type BrmagPosition = {
  title?: string | null;
  institution?: string | null;
  supervising_judge?: string | null;
  date_start?: string | null;
  date_end?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
};

type BrmagJudge = {
  judge_id?: string | null;
  cl_id?: string | null;
  fjc_id?: string | null;
  name_first?: string | null;
  name_middle?: string | null;
  name_last?: string | null;
  name_suffix?: string | null;
  nickname?: string | null;
  birth_year?: string | null;
  gender?: string | null;
  race?: string | null;
  religion?: string | null;
  political_party?: string | null;
  positions?: BrmagPosition[] | null;
};

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// BR/MAG dates arrive as YYYY-MM-DD, YYYY-MM or YYYY (partial data). The service
// term columns are DATE; coerce partial values to the first of the period so the
// timeline and the "Appointed" year still populate, and drop anything else.
export function parseBrmagDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const ym = trimmed.match(/^(\d{4})-(\d{2})$/);
  if (ym) return `${ym[1]}-${ym[2]}-01`;
  const y = trimmed.match(/^(\d{4})$/);
  if (y) return `${y[1]}-01-01`;
  return null;
}

// The judge_id prefix is authoritative for the two branches: "mag-*" magistrate,
// "bnk-*" bankruptcy.
export function brmagBranch(judgeId: string): "magistrate" | "bankruptcy" | null {
  if (/^mag-/i.test(judgeId)) return "magistrate";
  if (/^bnk-/i.test(judgeId)) return "bankruptcy";
  return null;
}

// A career entry is the JUDICIAL appointment (not a clerkship, trusteeship or
// private practice) when its title names the office for that branch.
export function isJudicialPosition(title: string | null | undefined, branch: "magistrate" | "bankruptcy"): boolean {
  if (!title) return false;
  const value = title.toLowerCase();
  return branch === "magistrate"
    ? value.includes("magistrate judge")
    : value.includes("bankruptcy judge");
}

function displayName(row: BrmagJudge): string | null {
  const parts = [row.name_first, row.name_middle, row.name_last, row.name_suffix]
    .map((part) => (part ?? "").trim())
    .filter(Boolean);
  return cleanJudgeDisplayName(parts.join(" "));
}

async function download(url: string, seedName: string): Promise<string> {
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "Jurvio judge roster importer/1.0" },
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) throw new Error(`BR/MAG download failed (${response.status}) for ${url}`);
    const body = await response.text();
    if (body.trim().length === 0) throw new Error(`BR/MAG download was empty for ${url}`);
    return body;
  } catch (liveError) {
    try {
      const bundled = await readFile(join(BRMAG_SEED_DIR, seedName), "utf8");
      if (bundled.trim().length === 0) throw new Error(`bundled BR/MAG seed ${seedName} was empty`);
      return bundled;
    } catch {
      throw liveError instanceof Error ? liveError : new Error(String(liveError));
    }
  }
}

export async function importBrmagJudges(
  sql: Sql,
  options: { artifactRoot?: string; limit?: number } = {},
): Promise<{ judges: number; services: number; courts: number; active: number; skipped: number; failedRows: number }> {
  const artifactRoot = options.artifactRoot ?? process.env.JURVIO_ARTIFACT_ROOT ?? "/var/lib/jurvio/artifacts";
  const text = await download(BRMAG_JSON_URL, "brmag-judges.json");

  // Provenance: store the raw JSON and resolve the BR/MAG provider id.
  const hash = createHash("sha256").update(text).digest("hex");
  const directory = join(artifactRoot, "brmag");
  const objectKey = join("brmag", `${hash}.json`);
  await mkdir(directory, { recursive: true });
  await writeFile(join(artifactRoot, objectKey), text, { flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
  const [provider] = await sql<{ id: string }[]>`
    INSERT INTO provider (code, name, base_url)
    VALUES ('brmag', 'BR/MAG Judge Database (UVA Legal Data Lab)', 'https://legaldatalab.law.virginia.edu/brmag-judges/')
    ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id
  `;
  if (!provider) throw new Error("BR/MAG provider was not persisted");
  const [storedArtifact] = await sql<{ id: string }[]>`
    INSERT INTO raw_artifact (provider_id, source_uri, content_hash, object_key, media_type, retrieved_at)
    VALUES (${provider.id}, ${BRMAG_JSON_URL}, ${hash}, ${objectKey}, 'application/json', now())
    ON CONFLICT (provider_id, source_uri, content_hash) DO UPDATE SET retrieved_at = EXCLUDED.retrieved_at
    RETURNING id
  `;
  if (!storedArtifact) throw new Error("BR/MAG artifact was not persisted");
  const providerId = provider.id;
  const artifactId = storedArtifact.id;

  const parsed = JSON.parse(text) as BrmagJudge[];
  const records = Array.isArray(parsed) ? parsed : [];

  // Existing courts, so magistrate/bankruptcy courts already present are reused
  // rather than duplicated. New Article I courts are created keyed by their
  // institution name.
  const existingCourts = await sql<{ id: string; name: string; providerCourtId: string | null }[]>`
    SELECT id, name, provider_court_id AS "providerCourtId" FROM court
  `;
  // Only PRE-EXISTING courts are cached for reuse; newly-created BR/MAG courts are
  // always re-upserted (idempotent via ON CONFLICT) rather than cached, so a
  // per-judge transaction that rolls back can never leave a dangling court id in
  // the cache for the next judge to reference.
  const existingCourtByName = new Map(existingCourts.map((court) => [normalizeKey(court.name), court.id]));
  const createdCourtKeys = new Set<string>();

  let judges = 0, services = 0, activeJudges = 0, skipped = 0, failedRows = 0;
  const limit = Math.min(Math.max(options.limit ?? 50_000, 1), 50_000);

  async function resolveCourt(tx: Sql, institution: string, state: string | null): Promise<string> {
    const norm = normalizeKey(institution);
    const existing = existingCourtByName.get(norm);
    if (existing) return existing;
    const [court] = await tx<{ id: string }[]>`
      INSERT INTO court (public_id, provider_id, provider_court_id, name, jurisdiction, verification, source_artifact_id)
      VALUES (${createPublicId("court")}, ${providerId}, ${`brmag:${norm}`}, ${institution}, ${state}, 'verified', ${artifactId})
      ON CONFLICT (provider_id, provider_court_id) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
      RETURNING id
    `;
    if (!court) throw new Error(`BR/MAG court ${institution} was not persisted`);
    createdCourtKeys.add(norm);
    return court.id;
  }

  for (const record of records.slice(0, limit)) {
    const judgeId = (record.judge_id ?? "").trim();
    const branch = judgeId ? brmagBranch(judgeId) : null;
    const name = displayName(record);
    const normalized = name ? normalizeJudgeName(name) : null;
    if (!judgeId || !branch || !name || !normalized) { skipped += 1; continue; }

    // The judicial appointment position(s) for this branch. A judge without one
    // (e.g. only a trusteeship in the data) is not part of the working bench.
    const judicialPositions = (record.positions ?? []).filter((p) => isJudicialPosition(p.title, branch)
      && (p.institution ?? "").trim().length > 0);
    if (judicialPositions.length === 0) { skipped += 1; continue; }

    const fjcId = (record.fjc_id ?? "").trim() || null;
    const detailUrl = `${BRMAG_DETAIL_BASE}/${encodeURIComponent(judgeId)}.html`;
    const isActive = judicialPositions.some((p) => !parseBrmagDate(p.date_end));

    const before = { judges, services, activeJudges };
    try {
      await sql.begin(async (tx) => {
        // Court for the primary (most recent) judicial appointment.
        const primary = judicialPositions[judicialPositions.length - 1]!;
        const primaryCourtId = await resolveCourt(tx, (primary.institution ?? "").trim(), (primary.state ?? "").trim() || null);

        // Dedup: a judge already in the Article III roster (fjc_id set and matched)
        // keeps their identity; otherwise match by brmag_id, then by court+name.
        let judge: { id: string } | undefined;
        [judge] = await tx<{ id: string }[]>`SELECT id FROM judge WHERE brmag_id = ${judgeId} LIMIT 1 FOR UPDATE`;
        if (!judge && fjcId) {
          [judge] = await tx<{ id: string }[]>`SELECT id FROM judge WHERE fjc_nid = ${fjcId} LIMIT 1 FOR UPDATE`;
          if (judge) await tx`UPDATE judge SET brmag_id = ${judgeId}, updated_at = now() WHERE id = ${judge.id}`;
        }
        if (!judge) {
          [judge] = await tx<{ id: string }[]>`
            INSERT INTO judge (public_id, display_name, normalized_name, court_id, active, verification,
              source_artifact_id, brmag_id, judge_type, official_profile_url)
            VALUES (${createPublicId("judge")}, ${name}, ${normalized}, ${primaryCourtId}, ${isActive}, 'verified',
              ${artifactId}, ${judgeId}, ${branch}, ${detailUrl})
            ON CONFLICT (court_id, normalized_name) DO UPDATE SET
              brmag_id = COALESCE(judge.brmag_id, EXCLUDED.brmag_id),
              judge_type = COALESCE(judge.judge_type, EXCLUDED.judge_type),
              official_profile_url = EXCLUDED.official_profile_url, verification = 'verified', updated_at = now()
            RETURNING id
          `;
        }
        if (!judge) throw new Error(`BR/MAG judge ${judgeId} was not persisted`);
        judges += 1;
        if (isActive) activeJudges += 1;

        await tx`
          INSERT INTO judge_name_variant (judge_id, display_value, normalized_value, variant_type, source_url, source_artifact_id)
          VALUES (${judge.id}, ${name}, ${normalized}, 'official', ${detailUrl}, ${artifactId})
          ON CONFLICT DO NOTHING
        `;
        if ((record.nickname ?? "").trim()) {
          const nick = record.nickname!.trim();
          const nickNorm = normalizeJudgeName([record.name_first, nick, record.name_last].filter(Boolean).join(" ")) ?? null;
          if (nickNorm) await tx`
            INSERT INTO judge_name_variant (judge_id, display_value, normalized_value, variant_type, source_url, source_artifact_id)
            VALUES (${judge.id}, ${nick}, ${nickNorm}, 'source_observed', ${detailUrl}, ${artifactId})
            ON CONFLICT DO NOTHING
          `;
        }

        // One service term per judicial appointment (a judge may have served in
        // more than one court). commission_date carries the start so the
        // "Appointed" year populates like the Article III lane.
        for (let index = 0; index < judicialPositions.length; index += 1) {
          const position = judicialPositions[index]!;
          const courtId = index === judicialPositions.length - 1
            ? primaryCourtId
            : await resolveCourt(tx, (position.institution ?? "").trim(), (position.state ?? "").trim() || null);
          const startedOn = parseBrmagDate(position.date_start);
          const endedOn = parseBrmagDate(position.date_end);
          const inserted = await tx`
            INSERT INTO judge_service_term (judge_id, court_id, service_type, started_on, ended_on,
              commission_date, court_category, source_system, source_record_key, source_url, source_artifact_id, verification)
            VALUES (${judge.id}, ${courtId}, ${branch}, ${startedOn}, ${endedOn},
              ${startedOn}, ${branch}, 'brmag', ${`${judgeId}:${index}`}, ${detailUrl}, ${artifactId}, 'verified')
            ON CONFLICT (source_system, source_record_key) DO UPDATE SET
              ended_on = EXCLUDED.ended_on, started_on = EXCLUDED.started_on,
              commission_date = EXCLUDED.commission_date, court_category = EXCLUDED.court_category, updated_at = now()
            RETURNING id
          `;
          services += inserted.length;
        }

        // Lightweight profile facts for the click-through detail (biographical
        // data the backend row does not surface).
        const facts: Array<[string, string]> = [];
        if ((record.gender ?? "").trim()) facts.push(["gender", record.gender!.trim()]);
        if ((record.race ?? "").trim()) facts.push(["race", record.race!.trim()]);
        if ((record.birth_year ?? "").trim()) facts.push(["birth_year", record.birth_year!.trim()]);
        if ((record.cl_id ?? "").trim()) facts.push(["courtlistener_id", record.cl_id!.trim()]);
        for (const [factType, value] of facts) {
          await tx`
            INSERT INTO judge_profile_fact (judge_id, fact_type, value_json, source_system, source_url, confidence)
            VALUES (${judge.id}, ${factType}, ${tx.json(value)}, 'brmag', ${detailUrl}, 0.9)
            ON CONFLICT DO NOTHING
          `;
        }

        await tx`UPDATE judge SET active = ${isActive}, updated_at = now() WHERE id = ${judge.id} AND fjc_nid IS NULL`;
      });
    } catch {
      ({ judges, services, activeJudges } = before);
      failedRows += 1;
    }
  }

  return { judges, services, courts: createdCourtKeys.size, active: activeJudges, skipped, failedRows };
}
