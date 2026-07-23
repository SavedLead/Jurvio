import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

export interface ProfessionalContact {
  type: "email" | "phone" | "website" | "office_address";
  value: string;
  href: string | null;
  sourceUrl: string;
  sourceKind: string;
  verifiedOn: string;
}

export interface AttorneySummary {
  publicId: string;
  displayName: string;
  caseCount: number;
  latestCaseDate: string | null;
}

export interface AttorneyProfile extends AttorneySummary {
  verification: string;
  authoritativeSourceUrl: string;
  indexable: boolean;
  contacts: ProfessionalContact[];
  affiliations: Array<{ firmPublicId: string; firmName: string; title: string | null; sourceUrl: string; verifiedOn: string }>;
  appearances: Array<{ casePublicId: string; caption: string; docketNumber: string; courtName: string; role: string; nameAsFiled: string; filedOn: string | null; sourceUrl: string | null }>;
}

export interface LawFirmProfile {
  publicId: string;
  displayName: string;
  verification: string;
  indexable: boolean;
  caseCount: number;
  latestCaseDate: string | null;
  contacts: ProfessionalContact[];
  attorneys: Array<{ publicId: string; displayName: string; title: string | null; sourceUrl: string; verifiedOn: string }>;
  appearances: AttorneyProfile["appearances"];
}

export interface LawFirmSummary {
  publicId: string;
  displayName: string;
  caseCount: number;
  latestCaseDate: string | null;
}

const displayableCase = `
  legal_case.publication = 'published'
  AND COALESCE((SELECT decision.displayable FROM publication_decision decision
    WHERE decision.object_type = 'legal_case' AND decision.object_id = legal_case.id
    ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1), false)
`;

export function canPublishProfessionalIdentity(input: { verification: string; authoritativeSourceUrl?: string | null }) {
  return input.verification === "verified" && Boolean(input.authoritativeSourceUrl?.trim());
}

export function canIndexProfessionalProfile(input: { verification: string; indexable: boolean; authoritativeSourceUrl?: string | null }) {
  return input.indexable && canPublishProfessionalIdentity(input);
}

export async function listPublicAttorneys(sql: Sql, limit = 50): Promise<AttorneySummary[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  return sql<AttorneySummary[]>`
    SELECT attorney.public_id AS "publicId", attorney.display_name AS "displayName",
      count(DISTINCT legal_case.id)::int AS "caseCount", max(legal_case.filed_on)::text AS "latestCaseDate"
    FROM attorney
    JOIN attorney_case_appearance appearance ON appearance.attorney_id = attorney.id
    JOIN legal_case ON legal_case.id = appearance.case_id
    WHERE attorney.verification = 'verified' AND attorney.authoritative_source_url IS NOT NULL
      AND ${sql.unsafe(displayableCase)}
      AND COALESCE((SELECT decision.displayable FROM publication_decision decision
        WHERE decision.object_type = 'attorney' AND decision.object_id = attorney.id
        ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1), false)
    GROUP BY attorney.id ORDER BY count(DISTINCT legal_case.id) DESC, attorney.display_name, attorney.public_id
    LIMIT ${safeLimit}
  `;
}

export async function listPublicLawFirms(sql: Sql, limit = 50): Promise<LawFirmSummary[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  return sql<LawFirmSummary[]>`
    SELECT firm.public_id AS "publicId", firm.display_name AS "displayName",
      count(DISTINCT legal_case.id)::int AS "caseCount", max(legal_case.filed_on)::text AS "latestCaseDate"
    FROM entity firm JOIN attorney_case_appearance appearance ON appearance.law_firm_entity_id = firm.id
    JOIN legal_case ON legal_case.id = appearance.case_id
    WHERE firm.entity_type = 'law_firm' AND firm.verification = 'verified' AND ${sql.unsafe(displayableCase)}
      AND COALESCE((SELECT decision.displayable FROM publication_decision decision WHERE decision.object_type = 'entity'
        AND decision.object_id = firm.id ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1), false)
    GROUP BY firm.id ORDER BY count(DISTINCT legal_case.id) DESC, firm.display_name, firm.public_id LIMIT ${safeLimit}
  `;
}

export async function getPublicAttorney(sql: Sql, publicId: string): Promise<AttorneyProfile | null> {
  const [attorney] = await sql<Array<Omit<AttorneyProfile, "contacts" | "affiliations" | "appearances">>>`
    SELECT attorney.public_id AS "publicId", attorney.display_name AS "displayName",
      attorney.verification::text AS verification, attorney.authoritative_source_url AS "authoritativeSourceUrl",
      count(DISTINCT legal_case.id)::int AS "caseCount", max(legal_case.filed_on)::text AS "latestCaseDate",
      COALESCE((SELECT decision.indexable FROM publication_decision decision
        WHERE decision.object_type = 'attorney' AND decision.object_id = attorney.id
        ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1), false) AS indexable
    FROM attorney JOIN attorney_case_appearance appearance ON appearance.attorney_id = attorney.id
    JOIN legal_case ON legal_case.id = appearance.case_id
    WHERE attorney.public_id = ${publicId} AND attorney.verification = 'verified'
      AND attorney.authoritative_source_url IS NOT NULL AND ${sql.unsafe(displayableCase)}
      AND COALESCE((SELECT decision.displayable FROM publication_decision decision
        WHERE decision.object_type = 'attorney' AND decision.object_id = attorney.id
        ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1), false)
    GROUP BY attorney.id LIMIT 1
  `;
  if (!attorney) return null;

  const contacts = await contactRows(sql, "attorney", publicId);
  const affiliations = await sql<AttorneyProfile["affiliations"]>`
    SELECT firm.public_id AS "firmPublicId", firm.display_name AS "firmName", affiliation.title,
      affiliation.source_url AS "sourceUrl", affiliation.verified_on::text AS "verifiedOn"
    FROM attorney_firm_affiliation affiliation JOIN attorney ON attorney.id = affiliation.attorney_id
    JOIN entity firm ON firm.id = affiliation.firm_entity_id
    WHERE attorney.public_id = ${publicId} AND firm.entity_type = 'law_firm' AND firm.verification = 'verified'
      AND COALESCE((SELECT decision.displayable FROM publication_decision decision
        WHERE decision.object_type = 'entity' AND decision.object_id = firm.id
        ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1), false)
    ORDER BY affiliation.ended_on DESC NULLS FIRST, firm.display_name
  `;
  const appearances = await attorneyAppearances(sql, "attorney", publicId);
  return { ...attorney, contacts, affiliations, appearances };
}

export async function getPublicLawFirm(sql: Sql, publicId: string): Promise<LawFirmProfile | null> {
  const [firm] = await sql<Array<Omit<LawFirmProfile, "contacts" | "attorneys" | "appearances">>>`
    SELECT firm.public_id AS "publicId", firm.display_name AS "displayName", firm.verification::text AS verification,
      count(DISTINCT legal_case.id)::int AS "caseCount", max(legal_case.filed_on)::text AS "latestCaseDate",
      COALESCE((SELECT decision.indexable FROM publication_decision decision WHERE decision.object_type = 'entity'
        AND decision.object_id = firm.id ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1), false) AS indexable
    FROM entity firm JOIN attorney_case_appearance appearance ON appearance.law_firm_entity_id = firm.id
    JOIN legal_case ON legal_case.id = appearance.case_id
    WHERE firm.public_id = ${publicId} AND firm.entity_type = 'law_firm' AND firm.verification = 'verified'
      AND ${sql.unsafe(displayableCase)}
      AND COALESCE((SELECT decision.displayable FROM publication_decision decision WHERE decision.object_type = 'entity'
        AND decision.object_id = firm.id ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1), false)
    GROUP BY firm.id LIMIT 1
  `;
  if (!firm) return null;
  const contacts = await contactRows(sql, "firm", publicId);
  const attorneys = await sql<LawFirmProfile["attorneys"]>`
    SELECT attorney.public_id AS "publicId", attorney.display_name AS "displayName", affiliation.title,
      affiliation.source_url AS "sourceUrl", affiliation.verified_on::text AS "verifiedOn"
    FROM attorney_firm_affiliation affiliation JOIN attorney ON attorney.id = affiliation.attorney_id
    JOIN entity firm ON firm.id = affiliation.firm_entity_id
    WHERE firm.public_id = ${publicId} AND attorney.verification = 'verified'
      AND COALESCE((SELECT decision.displayable FROM publication_decision decision WHERE decision.object_type = 'attorney'
        AND decision.object_id = attorney.id ORDER BY decision.decided_at DESC, decision.id DESC LIMIT 1), false)
    ORDER BY attorney.display_name, attorney.public_id
  `;
  const appearances = await attorneyAppearances(sql, "firm", publicId);
  return { ...firm, contacts, attorneys, appearances };
}

async function contactRows(sql: Sql, owner: "attorney" | "firm", publicId: string) {
  const ownerClause = owner === "attorney"
    ? sql`contact.attorney_id = (SELECT id FROM attorney WHERE public_id = ${publicId})`
    : sql`contact.firm_entity_id = (SELECT id FROM entity WHERE public_id = ${publicId})`;
  return sql<ProfessionalContact[]>`
    SELECT contact.contact_type AS type, contact.display_value AS value, contact.href,
      contact.source_url AS "sourceUrl", contact.source_kind AS "sourceKind", contact.verified_on::text AS "verifiedOn"
    FROM professional_contact contact WHERE ${ownerClause} AND contact.displayable
      AND contact.source_kind IN ('bar_directory', 'firm_website', 'government_directory')
    ORDER BY contact.contact_type, contact.display_value
  `;
}

async function attorneyAppearances(sql: Sql, owner: "attorney" | "firm", publicId: string) {
  const ownerClause = owner === "attorney"
    ? sql`attorney.public_id = ${publicId}`
    : sql`appearance.law_firm_entity_id = (SELECT id FROM entity WHERE public_id = ${publicId})`;
  return sql<AttorneyProfile["appearances"]>`
    SELECT legal_case.public_id AS "casePublicId", legal_case.caption, legal_case.docket_number AS "docketNumber",
      court.name AS "courtName", appearance.role, appearance.name_as_filed AS "nameAsFiled",
      legal_case.filed_on::text AS "filedOn", appearance.source_url AS "sourceUrl"
    FROM attorney_case_appearance appearance JOIN attorney ON attorney.id = appearance.attorney_id
    JOIN legal_case ON legal_case.id = appearance.case_id JOIN court ON court.id = legal_case.court_id
    WHERE ${ownerClause} AND ${sql.unsafe(displayableCase)}
    ORDER BY legal_case.filed_on DESC NULLS LAST, legal_case.caption LIMIT 100
  `;
}
