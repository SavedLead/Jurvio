/** Public copy for a decided case whose written opinion is not on Jurvio yet. */
export const OPINION_TEXT_PENDING_HEADING = "The full opinion isn't on Jurvio yet";

export const OPINION_TEXT_PENDING_BODY =
  "The court's decision is recorded below, but Jurvio doesn't have the text of the written opinion for this case yet. We'll add it here when we have it; until then, use the official source link where one is shown.";

export function opinionTextIsPending(hasReadableOpinion: boolean): boolean {
  return !hasReadableOpinion;
}
