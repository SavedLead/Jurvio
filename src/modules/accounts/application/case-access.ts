import type { PublicCase } from "@/modules/cases/application/get-public-case";

export type CaseAccess =
  | { status: "missing" }
  /** Subscriber-only record and this viewer is not a paid subscriber: render only the generic gate. */
  | { status: "gated" }
  | { status: "ok"; legalCase: PublicCase; subscriberOnly: boolean };

/**
 * Subscriber-only gate for one case. Public cases never ask about the viewer
 * (so ordinary pages never read the session); search-excluded cases open only
 * when `viewerIsSubscriber` resolves true.
 */
export async function resolveCaseAccess(
  legalCase: PublicCase | null,
  viewerIsSubscriber: () => Promise<boolean>,
): Promise<CaseAccess> {
  if (!legalCase) return { status: "missing" };
  if (!legalCase.searchExcluded) return { status: "ok", legalCase, subscriberOnly: false };
  if (!(await viewerIsSubscriber())) return { status: "gated" };
  return { status: "ok", legalCase, subscriberOnly: true };
}
