import { createHash } from "node:crypto";
import type postgres from "postgres";
import { createPublicId } from "@/lib/ids/public-id";
import { attorneyProfileCompleteness, normalizeUsaoAttorneyName } from "../domain/normalize-usao-attorney";

type Sql = ReturnType<typeof postgres>;
export const DOJ_US_ATTORNEYS_URL = "https://www.justice.gov/usao/us-attorneys-listing";

export type DojUsAttorney = {
  districtLabel: string;
  displayName: string;
  title: "U.S. Attorney" | "Acting U.S. Attorney";
};

function text(value: string): string {
  return value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&#039;|&apos;/gi, "'").replace(/&quot;/gi, '"').replace(/\s+/g, " ").trim();
}

export function parseDojUsAttorneys(html: string): DojUsAttorney[] {
  const records: DojUsAttorney[] = [];
  for (const row of html.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = row.match(/<t[dh]\b[\s\S]*?<\/t[dh]>/gi) ?? [];
    if (cells.length < 2) continue;
    const districtLabel = text(cells[0] ?? "");
    const rawName = text(cells[1] ?? "");
    const displayName = rawName.replace(/[\s*^#]+$/g, "").trim();
    if (!districtLabel || !normalizeUsaoAttorneyName(displayName)) continue;
    const title = rawName.endsWith("^") ? "Acting U.S. Attorney" : "U.S. Attorney";
    records.push({ districtLabel, displayName, title });
  }
  return records;
}

function districtKey(value: string): string {
  const commaParts = value.split(",").map((part) =>
    part.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim()
  );
  const clean = commaParts.join(" ");
  if (clean.includes("guam") && clean.includes("northern mariana")) return "guam and northern mariana islands";
  if (commaParts.length === 2 && commaParts[0] && commaParts[1]) {
    return `${commaParts[1]} district of ${commaParts[0]}`;
  }
  if (clean.startsWith("district of ")) return clean;
  return `district of ${clean}`;
}

function officeKey(value: string): string {
  return value.toLowerCase()
    .replace(/^u s attorney s office for /, "")
    .replace(/^united states attorney s office for /, "")
    .replace(/districts of /, "")
    .replace(/the /g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

export async function importDojUsAttorneyLeadership(sql: Sql): Promise<{
  discovered: number; inserted: number; updated: number; unmatched: string[];
}> {
  const response = await fetch(DOJ_US_ATTORNEYS_URL, {
    headers: { "user-agent": "Jurvio USAO roster importer/1.0" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`DOJ leadership download failed (${response.status})`);
  const html = await response.text();
  const records = parseDojUsAttorneys(html);
  if (records.length < 90) throw new Error(`DOJ leadership parser found only ${records.length} rows`);

  const [run] = await sql<{ id: string }[]>`
    INSERT INTO usao_roster_run (source_system, source_url, source_content_hash, status, discovered_count)
    VALUES ('doj-leadership', ${DOJ_US_ATTORNEYS_URL},
      ${createHash("sha256").update(html).digest("hex")}, 'running', ${records.length})
    RETURNING id
  `;
  if (!run) throw new Error("USAO roster run was not persisted");

  const offices = await sql<{ id: string; displayName: string; officeCode: string }[]>`
    SELECT id, display_name AS "displayName", office_code AS "officeCode" FROM usao_office
  `;
  const officeByKey = new Map(offices.map((office) => [officeKey(office.displayName), office]));
  let inserted = 0, updated = 0;
  const unmatched: string[] = [];

  try {
    for (const record of records) {
      const wanted = districtKey(record.districtLabel);
      const office = officeByKey.get(wanted) ?? [...officeByKey.entries()]
        .find(([key]) => key.includes(wanted) || wanted.includes(key))?.[1];
      const normalized = normalizeUsaoAttorneyName(record.displayName);
      if (!office || !normalized) { unmatched.push(record.districtLabel); continue; }
      const existing = await sql<{ id: string }[]>`
        SELECT id FROM usao_attorney WHERE office_id = ${office.id} AND normalized_name = ${normalized} LIMIT 1
      `;
      await sql`
        INSERT INTO usao_attorney (
          public_id, office_id, display_name, normalized_name, title, official_profile_url,
          active, verification, source_system, source_record_key, last_observed_at,
          last_verified_at, profile_completeness
        ) VALUES (
          ${createPublicId("attorney")}, ${office.id}, ${record.displayName}, ${normalized}, ${record.title},
          ${DOJ_US_ATTORNEYS_URL}, true, 'verified', 'doj-leadership',
          `${office.officeCode}:${normalized}`, now(), now(),
          ${attorneyProfileCompleteness({ title: record.title, officialProfileUrl: DOJ_US_ATTORNEYS_URL })}
        )
        ON CONFLICT (office_id, normalized_name) DO UPDATE SET
          display_name = EXCLUDED.display_name, title = EXCLUDED.title,
          official_profile_url = EXCLUDED.official_profile_url, active = true,
          verification = 'verified', source_system = 'doj-leadership',
          source_record_key = EXCLUDED.source_record_key, last_observed_at = now(),
          last_verified_at = now(), profile_completeness = EXCLUDED.profile_completeness,
          updated_at = now()
      `;
      if (existing.length) updated += 1; else inserted += 1;
    }
    await sql`UPDATE usao_roster_run SET status = 'succeeded', finished_at = now(),
      inserted_count = ${inserted}, updated_count = ${updated}, error_count = ${unmatched.length},
      error_summary = ${unmatched.length ? unmatched.join(", ") : null} WHERE id = ${run.id}`;
    return { discovered: records.length, inserted, updated, unmatched };
  } catch (error) {
    await sql`UPDATE usao_roster_run SET status = 'failed', finished_at = now(), error_count = 1,
      error_summary = ${error instanceof Error ? error.message : String(error)} WHERE id = ${run.id}`;
    throw error;
  }
}
