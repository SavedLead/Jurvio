import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { db } from "@/db/client";
import { getCoverageSnapshot } from "@/modules/trust/application/get-coverage-snapshot";
import { CoverageReport } from "@/modules/trust/ui/coverage-report";
import { TrustPage } from "@/modules/trust/ui/trust-page";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Legal Data Coverage",
  description:
    "Verified counts of the public legal records Jurvio publishes, the courts they come from, and the gaps that remain.",
  alternates: { canonical: "/coverage" },
};

// Coverage aggregates over the whole published corpus and moves only as fast as
// ingestion publishes. A five-minute snapshot keeps the page honest without
// re-running the aggregation for every reader and crawler.
const loadCoverageSnapshot = unstable_cache(
  async () => getCoverageSnapshot(db()),
  ["public-coverage-snapshot"],
  { revalidate: 300, tags: ["public-coverage"] },
);

export default async function CoveragePage() {
  const snapshot = await loadCoverageSnapshot();

  return (
    <TrustPage
      eyebrow="Data coverage"
      title="Know what Jurvio covers."
      introduction="Coverage is a factual product feature. Jurvio publishes the scope, source, and limitations of its public legal data instead of hiding them behind a marketing number."
      sections={[
        {
          title: "How to read these numbers",
          paragraphs: [
            "Every figure above is counted from Jurvio's production database at the time shown, and counts only records that have passed publication review. Draft, held, restricted, and suppressed records are excluded, so these totals are smaller than the volume Jurvio has ingested.",
            "Case-level records, opinions, and courts are reported separately so that one large number cannot obscure what is actually searchable. Coverage of a court is not coverage of every matter in that court, and coverage of a matter is not coverage of every filing in it.",
          ],
        },
        {
          title: "How coverage expands",
          paragraphs: [
            "Jurvio began with United States federal opinions and selected federal docket information from public and authorized sources. Coverage expands in measured batches after source, normalization, privacy, and publication checks pass — never by lowering the checks to raise a number.",
            "Where a court appears with a partial or empty roster above, that court is tracked but not yet contributing published records. It is listed so the gap is visible, not omitted so the coverage looks complete.",
          ],
        },
        {
          title: "Known limitations",
          paragraphs: [
            "Public legal datasets can be delayed, incomplete, corrected, sealed, or removed at the source. Some source documents are scanned images whose text cannot be extracted reliably enough to publish; those are counted above rather than quietly dropped. Entity matching can also remain unresolved when the public record does not contain enough identifying information.",
            "Jurvio preserves uncertainty. Missing information is shown as unknown rather than inferred and presented as fact, and the official court record remains authoritative in every case.",
          ],
        },
      ]}
    >
      <CoverageReport snapshot={snapshot} />
    </TrustPage>
  );
}
