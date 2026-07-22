import type { CourtListenerParty } from "../providers/courtlistener/schema";

export interface NormalizedCourtListenerParty {
  sourcePartyId: string;
  sourceUri: string;
  displayName: string;
  normalizedName: string;
  roles: Array<{
    role: string;
    endedOn?: string;
    nameAsFiled: string;
  }>;
}

function clean(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function dateOnly(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed.toISOString().slice(0, 10);
}

export function normalizeCourtListenerParty(
  source: CourtListenerParty,
  docketId: number,
): NormalizedCourtListenerParty {
  const displayName = clean(source.name);
  if (!displayName) throw new Error("CourtListener party is missing a usable name");

  const sourceUri = source.resource_uri.trim();
  if (!sourceUri) throw new Error("CourtListener party is missing resource_uri");

  const roles = source.party_types
    .filter((partyType) => partyType.docket_id === docketId)
    .map((partyType) => ({
      role: clean(partyType.name),
      endedOn: dateOnly(partyType.date_terminated),
      nameAsFiled: displayName,
    }))
    .filter((partyType) => partyType.role.length > 0);

  if (roles.length === 0) {
    throw new Error("CourtListener party has no role for the requested docket");
  }

  return {
    sourcePartyId: String(source.id),
    sourceUri,
    displayName,
    normalizedName: displayName.toLocaleLowerCase("en-US"),
    roles,
  };
}
