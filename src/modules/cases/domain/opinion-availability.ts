/**
 * Reader-facing copy for a decided case whose written opinion text is not
 * shown on the page. Never internal wording ("not on Jurvio yet", "pending"):
 * point the reader at the official source, or say nothing.
 */
export interface OfficialOpinionNotice {
  heading: string;
  body: string;
  linkLabel: string;
  href: string;
}

function sourceName(href: string): string {
  let host = "";
  try {
    host = new URL(href).hostname.toLowerCase();
  } catch {
    return "the official source";
  }
  if (host.endsWith("loc.gov")) return "the official United States Reports, published by the Library of Congress";
  if (host.endsWith("supremecourt.gov")) return "the Supreme Court's website";
  if (host.endsWith("uscourts.gov") || host.endsWith("govinfo.gov")) return "the court's official records";
  return "the official source";
}

/** A notice that links to the official opinion; null when there is no official link to give. */
export function officialOpinionNotice(officialUrl: string | null | undefined): OfficialOpinionNotice | null {
  if (!officialUrl || !/^https:\/\//.test(officialUrl)) return null;
  return {
    heading: "Read the court's full opinion",
    body: `The court's full written opinion is available from ${sourceName(officialUrl)}.`,
    linkLabel: /\.pdf(?:$|[?#])/i.test(officialUrl) ? "Read the official opinion (PDF)" : "Read the official opinion",
    href: officialUrl,
  };
}

export function opinionTextIsPending(hasReadableOpinion: boolean): boolean {
  return !hasReadableOpinion;
}

const PDF_HOSTS = [
  "supremecourt.gov",
  "www.supremecourt.gov",
  "tile.loc.gov",
  "www.loc.gov",
  "www.govinfo.gov",
  "govinfo.gov",
];

/** An https PDF on a court or official-reporter host that the opinion page can embed. */
export function viewableOpinionPdf(value: string | null | undefined): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  const allowed = PDF_HOSTS.includes(host) || host.endsWith(".uscourts.gov") || host.endsWith(".loc.gov");
  if (!allowed) return null;
  const path = `${url.pathname}${url.search}`.toLowerCase();
  if (!path.includes(".pdf")) return null;
  return url.toString();
}

export function opinionHasExtractedText(opinion: { wordCount: number; contentText: string }): boolean {
  return opinion.wordCount > 0 && /\S/.test(opinion.contentText);
}
