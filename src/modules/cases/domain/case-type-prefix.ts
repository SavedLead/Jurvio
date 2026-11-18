/**
 * Eastern District of California puts a short case-type code at the front of
 * the caption, for example "(HC) Cabrera Velasquez v. Mullin". The stored
 * caption keeps that code so search still matches it. Display drops only the
 * codes confirmed below and shows the plain-language label instead.
 *
 * Confirmed from the court's own records:
 * - (HC) habeas corpus: E.D. Cal. captions and Nature of Suit 530, cause 28 U.S.C. § 2254 or § 2241.
 * - (PC) prisoner civil rights: the court's "Prisoner Civil Rights Complaint" and cause 42 U.S.C. § 1983.
 * - (SS) social security: captions against the Commissioner of Social Security, and the court's SOCIAL_SECURITY flag.
 * - (PS) pro se: docket numbers end in (PS), the plaintiff is described as proceeding pro se, and Local Rule 302(c)(21) is the pro se referral. The court's PRO_SE flag uses the same words.
 *
 * An unrecognized code, including (SC), stays in the title.
 */
const LEADING_PREFIX = /^\(([A-Za-z][A-Za-z0-9]{0,5})\)\s*/;

export const CASE_TYPE_PREFIX_LABELS: Readonly<Record<string, string>> = {
  HC: "Habeas corpus",
  PC: "Prisoner civil rights",
  SS: "Social security",
  PS: "Pro se",
};

export interface CaseTypePrefix {
  code: string;
  label: string;
}

export function splitCaseTypePrefix(caption: string): { caption: string; types: CaseTypePrefix[] } {
  let rest = caption.trim();
  const types: CaseTypePrefix[] = [];
  while (rest) {
    const match = LEADING_PREFIX.exec(rest);
    if (!match) break;
    const code = match[1]!.toUpperCase();
    const label = CASE_TYPE_PREFIX_LABELS[code];
    if (!label) break;
    types.push({ code, label });
    rest = rest.slice(match[0].length).trimStart();
  }
  return { caption: rest, types };
}
