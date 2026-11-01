/** Stable dictionary key for a term; also its anchor on /explainers (#term-<key>). */
export function termKey(term: string) {
  return term.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
