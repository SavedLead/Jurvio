// Party follows match by name: a follow stores the party's normalized name and
// matches any public case whose caption names that party. Production has no
// structured party records for most cases, so the caption (already shown on
// every public case page) is the source; party_appearance names, when they
// exist, are matched too.
//
// Normalization: lower case, every run of non-letters/digits becomes one
// space. The SQL twin is partyCaptionKeySql; keep them in step.

const ROLE_SUFFIX = /(?:,?\s+(?:et\s+al\.?|petitioners?|respondents?|appellants?|appellees?|plaintiffs?|defendants?|debtors?|movants?|cross-appellants?|cross-appellees?))+\s*[.,;]*\s*$/i;
const IN_RE = /^\s*(?:in\s+re:?|in\s+the\s+matter\s+of:?|matter\s+of:?|ex\s+parte)\s+/i;
const SPLIT = /\s+(?:v\.?|vs\.?|versus)\s+/i;

/** Words that mark an anonymised or protected party; such names are never followable. */
const PROTECTED_WORDS = new Set([
  "doe", "does", "roe", "sealed", "seal", "unknown", "unnamed", "anonymous", "juvenile", "minor", "minors",
  "redacted", "confidential", "restricted", "suppressed", "unidentified", "jdoe",
]);

export const PARTY_KEY_MAX = 120;

export function partyKey(name: string): string {
  return name.toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Display form of one side of a caption: trimmed, without "et al." or role words. */
export function cleanPartyName(raw: string): string {
  let name = raw.replace(/\s+/g, " ").trim();
  name = name.replace(IN_RE, "");
  for (let i = 0; i < 3; i++) name = name.replace(ROLE_SUFFIX, "").trim();
  return name.replace(/[\s,;:]+$/, "").slice(0, PARTY_KEY_MAX).trim();
}

/** Whether a party name may be followed: long enough, not initials only, not anonymised. */
export function isFollowablePartyName(name: string): boolean {
  const key = partyKey(name);
  if (key.length < 4 || key.length > PARTY_KEY_MAX) return false;
  const words = key.split(" ");
  if (!words.some((word) => /\p{L}{2,}/u.test(word))) return false;
  if (words.every((word) => word.length <= 1)) return false;
  return !words.some((word) => PROTECTED_WORDS.has(word));
}

/** Followable parties named in a caption ("A v. B" -> ["A", "B"]; "In re X" -> ["X"]). */
export function partiesFromCaption(caption: string | null | undefined): string[] {
  if (!caption?.trim()) return [];
  const sides = caption.split(SPLIT).slice(0, 2);
  const names: string[] = [];
  for (const side of sides) {
    const name = cleanPartyName(side);
    if (isFollowablePartyName(name) && !names.some((existing) => partyKey(existing) === partyKey(name))) names.push(name);
  }
  return names;
}

/** True when the caption names the party (whole words, normalized). In-memory twin of partyCaptionMatchSql. */
export function captionNamesParty(caption: string, key: string): boolean {
  return ` ${partyKey(caption)} `.includes(` ${key} `);
}

/**
 * SQL: caption column `captionExpr` names the party whose key is in `keyExpr`.
 * Both arguments are column references, never request values.
 */
export function partyCaptionMatchSql(captionExpr: string, keyExpr: string): string {
  for (const expr of [captionExpr, keyExpr]) {
    if (!/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/.test(expr)) throw new Error("invalid column");
  }
  return `(' ' || btrim(regexp_replace(lower(${captionExpr}), '[^[:alnum:]]+', ' ', 'g')) || ' ') LIKE ('% ' || ${keyExpr} || ' %')`;
}
