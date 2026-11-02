/** Plain-English role of one justice in one decision, read only from SCDB codes. */
export function lineupRole(vote: {
  side: "majority" | "dissent" | "not recorded";
  vote: number | null;
  opinion: number | null;
  wroteMajorityOpinion: boolean;
}): string {
  const wrote = vote.opinion === 2 || vote.opinion === 3;
  if (vote.wroteMajorityOpinion) return "Wrote the Court’s opinion";
  if (vote.side === "dissent") return wrote ? "Dissented and wrote a dissent" : "Dissented";
  if (vote.vote === 3) return wrote ? "Joined the majority and wrote a concurrence" : "Joined the majority and a concurrence";
  if (vote.vote === 4) return wrote ? "Agreed with the result only and wrote a concurrence" : "Agreed with the result only (special concurrence)";
  if (vote.side === "majority") return "Joined the majority";
  return "Vote not recorded by SCDB";
}

/** "0.6923" -> "69%"; null (no denominator) -> "—". */
export function percent(rate: number | null, digits = 0): string {
  return rate === null || !Number.isFinite(rate) ? "—" : `${(rate * 100).toFixed(digits)}%`;
}

/** "OT2024" style label for an SCDB term (the October Term beginning that year). */
export const termLabel = (term: number) => `OT${term}`;

/** "John Glover Roberts, Jr." -> "Roberts"; used for compact labels only. */
export function shortName(name: string): string {
  return name.replace(/,?\s+(Jr|Sr)\.?$/, "").split(" ").at(-1) ?? name;
}
