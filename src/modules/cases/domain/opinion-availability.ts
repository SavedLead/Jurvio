/** Public copy for a published case whose opinion text is not on Jurvio yet. */
export const OPINION_TEXT_PENDING_HEADING = "Opinion text is pending";

export const OPINION_TEXT_PENDING_BODY =
  "Jurvio has published the verified case details for this docket. The opinion text has not been added yet and will appear on this page when it is available.";

export function opinionTextIsPending(hasReadableOpinion: boolean): boolean {
  return !hasReadableOpinion;
}
