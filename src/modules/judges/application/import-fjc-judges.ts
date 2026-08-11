import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type postgres from "postgres";
import { createPublicId } from "@/lib/ids/public-id";
import { cleanJudgeDisplayName, normalizeJudgeName } from "../domain/normalize-judge-name";

type Sql = ReturnType<typeof postgres>;
type CsvRow = Record<string, string>;

export const FJC_DEMOGRAPHICS_URL =
  "https://www.fjc.gov/sites/default/files/history/demographics.csv";
export const FJC_SERVICE_URL =
  "https://www.fjc.gov/sites/default/files/history/federal-judicial-service.csv";

function key(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function field(row: CsvRow, ...aliases: string[]): string {
  const wanted = new Set(aliases.map(key));
  for (const [name, value] of Object.entries(row)) {
    if (wanted.has(key(name))) return value.trim();
  }
  return "";
}

export function parseCsv(input: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [], value = "", quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '"') {
      if (quoted && input[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(value); value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      row.push(value); value = "";
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
    } else value += character;
  }
  if (value || row.length) { row.push(value); rows.push(row); }
  const [headers, ...records] = rows;
  if (!headers) return [];
  return records.map((record) => Object.fromEntries(
    headers.map((header, index) => [header.replace(/^\uFEFF/, "").trim(), record[index] ?? ""]),
  ));
}

function parseDate(value: string): string | null {
  if (!value) return null;
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const month = match?.[1], day = match?.[2], year = match?.[3];
  if (month && day && year) return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export function parseSeatId(value: string): { courtCode: string; seat: number; succession: number } | null {
  const match = value.trim().match(/^([A-Z0-9]+?)(\d{2})(\d{2})$/i);
  const courtCode = match?.[1], seat = match?.[2], succession = match?.[3];
  if (!courtCode || !seat || !succession) return null;
  return { courtCode: courtCode.toLowerCase(), seat: Number(seat), succession: Number(succession) };
}

function displayName(row: CsvRow): string | null {
  const parts = [field(row, "First Name", "First"), field(row, "Middle Name", "Middle"),
    field(row, "Last Name", "Last"), field(row, "Suffix")].filter(Boolean);
  return cleanJudgeDisplayName(parts.join(" "));
}

async function download(url: string): Promise<string> {
  const response = await fetch(url, { headers: { "user-agent": "Jurvio judge roster importer/1.0" } });
  if (!response.ok) throw new Error(`FJC download failed (${response.status}) for ${url}`);
  return response.text();
}

async function artifact(sql: Sql, url: string, content: string, artifactRoot: string): Promise<string> {
  const hash = createHash("sha256").update(content).digest("hex");
  const directory = join(artifactRoot, "fjc");
  const objectKey = join("fjc", `${hash}.csv`);
  await mkdir(directory, { recursive: true });
  await writeFile(join(artifactRoot, objectKey), content, { flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
  const [provider] = await sql<{ id: string }[]>`
    INSERT INTO provider (code, name, base_url) VALUES ('fjc', 'Federal Judicial Center', 'https://www.fjc.gov')
    ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id
  `;
  if (!provider) throw new Error("FJC provider was not persisted");
  const [stored] = await sql<{ id: string }[]>`
    INSERT INTO raw_artifact (provider_id, source_uri, content_hash, object_key, media_type, retrieved_at)
    VALUES (${provider.id}, ${url}, ${hash}, ${objectKey}, 'text/csv', now())
    ON CONFLICT (provider_id, source_uri, content_hash) DO UPDATE SET retrieved_at = EXCLUDED.retrieved_at
    RETURNING id
  `;
  if (!stored) throw new Error("FJC artifact was not persisted");
  return stored.id;
}

export async function importFjcJudges(
  sql: Sql,
  options: { artifactRoot?: string; limit?: number } = {},
): Promise<{ judges: number; services: number; seats: number; unmatchedCourts: number }> {
  const artifactRoot = options.artifactRoot ?? process.env.JURVIO_ARTIFACT_ROOT ?? "/var/lib/jurvio/artifacts";
  const [demographicsText, serviceText] = await Promise.all([
    download(FJC_DEMOGRAPHICS_URL), download(FJC_SERVICE_URL),
  ]);
  const [demographicsArtifactId, serviceArtifactId] = await Promise.all([
    artifact(sql, FJC_DEMOGRAPHICS_URL, demographicsText, artifactRoot),
    artifact(sql, FJC_SERVICE_URL, serviceText, artifactRoot),
  ]);
  const demographics = parseCsv(demographicsText);
  const serviceRows = parseCsv(serviceText);
  const people = new Map(demographics.map((row) => [field(row, "nid", "Node ID"), row]));
  const courts = await sql<{ id: string; name: string; providerCourtId: string | null }[]>`
    SELECT id, name, provider_court_id AS "providerCourtId" FROM court
  `;
  const courtByCode = new Map(courts.filter((court) => court.providerCourtId)
    .map((court) => [key(court.providerCourtId ?? ""), court]));
  const courtByName = new Map(courts.map((court) => [key(court.name), court]));
  let judges = 0, services = 0, seats = 0, unmatchedCourts = 0;
  const limit = Math.min(Math.max(options.limit ?? 50_000, 1), 50_000);

  for (const service of serviceRows.slice(0, limit)) {
    const nid = field(service, "nid", "Node ID");
    const person = people.get(nid);
    const name = person ? displayName(person) : null;
    const normalized = name ? normalizeJudgeName(name) : null;
    const seat = parseSeatId(field(service, "Seat ID", "SeatID"));
    const sourceCourtName = field(service, "Court Name", "Court");
    const court = (seat ? courtByCode.get(key(seat.courtCode)) : undefined) ?? courtByName.get(key(sourceCourtName));
    if (!nid || !name || !normalized || !court) { if (!court) unmatchedCourts += 1; continue; }
    const profileUrl = `https://www.fjc.gov/node/${encodeURIComponent(nid)}`;
    await sql.begin(async (tx) => {
      let [judge] = await tx<{ id: string }[]>`SELECT id FROM judge WHERE fjc_nid = ${nid} LIMIT 1 FOR UPDATE`;
      if (!judge) [judge] = await tx<{ id: string }[]>`
        INSERT INTO judge (public_id, display_name, normalized_name, court_id, active, verification,
          source_artifact_id, fjc_nid, judge_type, official_profile_url)
        VALUES (${createPublicId("judge")}, ${name}, ${normalized}, ${court.id}, true, 'verified',
          ${demographicsArtifactId}, ${nid}, 'article_iii', ${profileUrl})
        ON CONFLICT (court_id, normalized_name) DO UPDATE SET fjc_nid = COALESCE(judge.fjc_nid, EXCLUDED.fjc_nid),
          official_profile_url = EXCLUDED.official_profile_url, verification = 'verified', updated_at = now()
        RETURNING id
      `;
      if (!judge) throw new Error(`Judge ${nid} was not persisted`);
      judges += 1;
      await tx`
        INSERT INTO judge_name_variant (judge_id, display_value, normalized_value, variant_type, source_url, source_artifact_id)
        VALUES (${judge.id}, ${name}, ${normalized}, 'official', ${profileUrl}, ${demographicsArtifactId})
        ON CONFLICT DO NOTHING
      `;
      let judicialSeatId: string | null = null;
      if (seat) {
        const seatKey = `${seat.courtCode}${String(seat.seat).padStart(2, "0")}`;
        const [storedSeat] = await tx<{ id: string }[]>`
          INSERT INTO judicial_seat (court_id, source_system, source_seat_key, seat_number, source_url, source_artifact_id)
          VALUES (${court.id}, 'fjc', ${seatKey}, ${seat.seat}, ${FJC_SERVICE_URL}, ${serviceArtifactId})
          ON CONFLICT (source_system, source_seat_key) DO UPDATE SET updated_at = now() RETURNING id
        `;
        judicialSeatId = storedSeat?.id ?? null; seats += storedSeat ? 1 : 0;
      }
      const commissionDate = parseDate(field(service, "Commission Date"));
      const seniorDate = parseDate(field(service, "Senior Status Date"));
      const terminationDate = parseDate(field(service, "Termination Date"));
      const sourceRecordKey = `${nid}:${field(service, "Seat ID", "SeatID") || key(sourceCourtName)}`;
      const activeEnd = seniorDate ?? terminationDate;
      const active = await tx`
        INSERT INTO judge_service_term (judge_id, court_id, judicial_seat_id, service_type, started_on, ended_on,
          succession_order, commission_date, termination_reason, source_system, source_record_key, source_url,
          source_artifact_id, verification)
        VALUES (${judge.id}, ${court.id}, ${judicialSeatId}, 'article_iii_active', ${commissionDate}, ${activeEnd},
          ${seat?.succession ?? null}, ${commissionDate}, ${field(service, "Termination Reason") || null}, 'fjc',
          ${`${sourceRecordKey}:active`}, ${FJC_SERVICE_URL}, ${serviceArtifactId}, 'verified')
        ON CONFLICT (source_system, source_record_key) DO UPDATE SET ended_on = EXCLUDED.ended_on,
          termination_reason = EXCLUDED.termination_reason, updated_at = now() RETURNING id
      `;
      services += active.length;
      if (seniorDate) {
        const senior = await tx`
          INSERT INTO judge_service_term (judge_id, court_id, judicial_seat_id, service_type, started_on, ended_on,
            source_system, source_record_key, source_url, source_artifact_id, verification)
          VALUES (${judge.id}, ${court.id}, ${judicialSeatId}, 'article_iii_senior', ${seniorDate}, ${terminationDate},
            'fjc', ${`${sourceRecordKey}:senior`}, ${FJC_SERVICE_URL}, ${serviceArtifactId}, 'verified')
          ON CONFLICT (source_system, source_record_key) DO UPDATE SET ended_on = EXCLUDED.ended_on, updated_at = now()
          RETURNING id
        `;
        services += senior.length;
      }
      await tx`UPDATE judge SET active = EXISTS (
        SELECT 1 FROM judge_service_term term WHERE term.judge_id = ${judge.id}
          AND (term.started_on IS NULL OR term.started_on <= current_date)
          AND (term.ended_on IS NULL OR term.ended_on >= current_date)
      ), updated_at = now() WHERE id = ${judge.id}`;
    });
  }
  return { judges, services, seats, unmatchedCourts };
}
