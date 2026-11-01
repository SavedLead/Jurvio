/**
 * Reader-facing names for stored enum values (document types, party roles,
 * opinion types). Pages must not print raw values such as "judicial_opinion"
 * or "counter_defendant".
 */
function humanize(value: string) {
  const text = value.replaceAll("_", " ").replaceAll("-", " ").replace(/\s+/g, " ").trim().toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

const DOCUMENT_TYPES: Record<string, string> = {
  "judicial opinion": "Court opinion",
  judicial_opinion: "Court opinion",
  opinion: "Court opinion",
  docket_document: "Court filing",
  "docket document": "Court filing",
  order: "Court order",
  court_order: "Court order",
  slip_opinion: "Court opinion",
  oral_argument_transcript: "Oral argument transcript",
  oral_argument_audio: "Oral argument audio",
  brief: "Brief",
  petition: "Petition",
};

export function publicDocumentType(value: string | null | undefined): string {
  if (!value) return "Court document";
  return DOCUMENT_TYPES[value.toLowerCase()] ?? humanize(value);
}

const PARTY_ROLES: Record<string, string> = {
  counter_claimant: "Counterclaimant",
  counter_defendant: "Counter-defendant",
  cross_claimant: "Cross-claimant",
  cross_defendant: "Cross-defendant",
  third_party_plaintiff: "Third-party plaintiff",
  third_party_defendant: "Third-party defendant",
  amicus: "Amicus (friend of the court)",
  amicus_curiae: "Amicus (friend of the court)",
  intervenor: "Intervenor",
  unknown: "Party",
  other: "Party",
};

export function publicPartyRole(value: string | null | undefined): string {
  if (!value) return "Party";
  return PARTY_ROLES[value.toLowerCase()] ?? humanize(value);
}

const OPINION_TYPES: Record<string, string> = {
  "combined-opinion": "Opinion",
  "lead-opinion": "Lead opinion",
  "majority": "Majority opinion",
  "majority-opinion": "Majority opinion",
  "court_opinion": "Opinion of the Court",
  "concurrence": "Concurring opinion",
  "concurring-opinion": "Concurring opinion",
  "dissent": "Dissenting opinion",
  "dissenting-opinion": "Dissenting opinion",
  "per-curiam": "Per curiam opinion",
  "remittitur": "Remittitur",
  // CourtListener codes ("010combined", "040dissent", ...), matched without the number.
  combined: "Opinion",
  unanimous: "Unanimous opinion",
  unamimous: "Unanimous opinion",
  lead: "Lead opinion",
  plurality: "Plurality opinion",
  concurrenceinpart: "Concurring in part",
  addendum: "Addendum",
  rehearing: "Opinion on rehearing",
  onthemerits: "Opinion on the merits",
  onmotiontostrike: "Opinion on a motion to strike",
};

/** null for unknown/blank so callers can hide the row. */
export function publicOpinionType(value: string | null | undefined): string | null {
  if (!value || value === "unknown") return null;
  const key = value.toLowerCase();
  const bare = key.replace(/^\d+-?/, "");
  return OPINION_TYPES[key] ?? OPINION_TYPES[bare] ?? humanize(bare);
}
