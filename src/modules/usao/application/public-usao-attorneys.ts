import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

export type PublicUsaoAttorney = {
  publicId: string; displayName: string; title: string | null; division: string | null;
  biography: string | null; officialProfileUrl: string | null; photoUrl: string | null;
  officePublicId: string; officeDisplayName: string; caseCount: number;
  latestAppearanceOn: string | null; sourceSystem: string; lastVerifiedAt: string | null;
  profileCompleteness: number;
};

export async function listPublicUsaoAttorneys(sql: Sql, limit = 500): Promise<PublicUsaoAttorney[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 5000);
  return sql<PublicUsaoAttorney[]>`
    SELECT public_id AS "publicId", display_name AS "displayName", title, division, biography,
      official_profile_url AS "officialProfileUrl", photo_url AS "photoUrl",
      office_public_id AS "officePublicId", office_display_name AS "officeDisplayName",
      case_count AS "caseCount", latest_appearance_on::text AS "latestAppearanceOn",
      source_system AS "sourceSystem", last_verified_at::text AS "lastVerifiedAt",
      profile_completeness AS "profileCompleteness"
    FROM usao_attorney_public_directory
    ORDER BY case_count DESC, display_name ASC LIMIT ${safeLimit}
  `;
}

export async function getPublicUsaoAttorney(sql: Sql, publicId: string): Promise<PublicUsaoAttorney | null> {
  const rows = await sql<PublicUsaoAttorney[]>`
    SELECT public_id AS "publicId", display_name AS "displayName", title, division, biography,
      official_profile_url AS "officialProfileUrl", photo_url AS "photoUrl",
      office_public_id AS "officePublicId", office_display_name AS "officeDisplayName",
      case_count AS "caseCount", latest_appearance_on::text AS "latestAppearanceOn",
      source_system AS "sourceSystem", last_verified_at::text AS "lastVerifiedAt",
      profile_completeness AS "profileCompleteness"
    FROM usao_attorney_public_directory WHERE public_id = ${publicId} LIMIT 1
  `;
  return rows[0] ?? null;
}
