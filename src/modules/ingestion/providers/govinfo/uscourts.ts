/**
 * GovInfo USCOURTS collection: the free, official copy of opinions and
 * written orders that federal courts send to the GPO. Pure helpers: package
 * parsing and URLs. One package is one case; its dateIssued is the newest
 * opinion in it. https://api.govinfo.gov/docs
 */
export interface GovInfoPackage {
  packageId: string;
  title?: string | null;
  dateIssued?: string | null;
  lastModified?: string | null;
}

export interface GovInfoCollectionPage {
  count?: number;
  nextPage?: string | null;
  packages?: GovInfoPackage[];
}

export interface ParsedGovInfoPackage {
  packageId: string;
  /** Jurvio court code (cadc, cafc, nysd ...). */
  courtCode: string;
  courtType: "appellate" | "district";
  docketNumber: string;
  caption: string;
  dateIssued: string;
  lastModified: string | null;
  detailsUrl: string;
}

/** GovInfo court codes that differ from Jurvio's. */
const APPELLATE: Readonly<Record<string, string>> = {
  ca1: "ca1", ca2: "ca2", ca3: "ca3", ca4: "ca4", ca5: "ca5", ca6: "ca6", ca7: "ca7", ca8: "ca8", ca9: "ca9",
  ca10: "ca10", ca11: "ca11", cadc: "cadc", ca13: "cafc", cafc: "cafc",
};

export const GOVINFO_API = "https://api.govinfo.gov";

/**
 * Parse "USCOURTS-nywd-1_17-cv-00937" or "USCOURTS-ca5-25-60590". Returns null
 * for courts outside the tracked districts and circuits (bankruptcy courts,
 * the Court of International Trade, the Court of Federal Claims).
 */
export function parseGovInfoPackage(pkg: GovInfoPackage, districtCodes: ReadonlySet<string>): ParsedGovInfoPackage | null {
  const match = /^USCOURTS-([A-Za-z0-9]+)-(.+)$/.exec(pkg.packageId ?? "");
  if (!match) return null;
  const govCode = match[1]!.toLowerCase();
  const appellate = APPELLATE[govCode];
  const courtType = appellate ? "appellate" : districtCodes.has(govCode) ? "district" : null;
  if (!courtType) return null;
  const dateIssued = /^\d{4}-\d{2}-\d{2}/.exec(pkg.dateIssued ?? "")?.[0];
  if (!dateIssued) return null;
  const docketNumber = match[2]!.replace(/^(\d+)_/, "$1:");
  if (!/\d{2}-/.test(docketNumber)) return null;
  return {
    packageId: pkg.packageId, courtCode: appellate ?? govCode, courtType, docketNumber,
    caption: (pkg.title ?? "").replace(/\s+/g, " ").trim().slice(0, 500) || docketNumber,
    dateIssued, lastModified: pkg.lastModified ?? null,
    detailsUrl: `https://www.govinfo.gov/app/details/${encodeURIComponent(pkg.packageId)}`,
  };
}

/** Packages modified since `since` (newest first), one page. The key is added by the caller and never stored. */
export function collectionUrl(since: string, offsetMark: string | null, pageSize: number): string {
  const start = since.replace(/\.\d{3}Z$/, "Z");
  return `${GOVINFO_API}/collections/USCOURTS/${start}?offsetMark=${encodeURIComponent(offsetMark ?? "*")}&pageSize=${pageSize}`;
}

/** offsetMark of the next page, or null when this was the last page. */
export function nextOffsetMark(page: GovInfoCollectionPage): string | null {
  if (!page.nextPage) return null;
  try {
    return new URL(page.nextPage).searchParams.get("offsetMark");
  } catch {
    return null;
  }
}

/** Docket number without a trailing judge suffix, lowercased alphanumerics: 1:25-cr-00211-NRM -> 125cr00211. */
export function baseDocketKey(value: string): string {
  const base = /^(\d+:\d{2}-[a-z]{1,5}-\d{1,7})/i.exec(value.trim())?.[1] ?? value;
  return base.toLowerCase().replace(/[^a-z0-9]/g, "");
}
