/**
 * Public URL slugs for Supreme Court justices (/justices/[slug]).
 *
 * The slug is the SCDB-roster display name, ASCII-folded. Names that repeat in
 * the roster (John Marshall Harlan I and II; John Rutledge and Charles Evans
 * Hughes, who each have two SCDB justice ids for two separate appointments)
 * get the year their SCDB service began, so every slug names exactly one
 * SCDB justice id and none is guessed.
 */
export interface SluggableJustice {
  scdbJusticeId: number;
  displayName: string;
  serviceStart: string | null;
}

export function slugifyName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function justiceSlugs<T extends SluggableJustice>(justices: readonly T[]): Map<number, string> {
  const counts = new Map<string, number>();
  for (const justice of justices) {
    const base = slugifyName(justice.displayName);
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  const slugs = new Map<number, string>();
  for (const justice of justices) {
    const base = slugifyName(justice.displayName);
    const year = justice.serviceStart?.slice(0, 4);
    slugs.set(justice.scdbJusticeId, (counts.get(base) ?? 0) > 1 && year ? `${base}-${year}` : base);
  }
  return slugs;
}
