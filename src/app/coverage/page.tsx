import type { Metadata } from "next";
import { TrustPage } from "@/modules/trust/ui/trust-page";

export const metadata: Metadata = {
  title: "Legal Data Coverage",
  description: "Understand which public legal records Jurvio covers, their sources, and their update status.",
};

export default function CoveragePage() {
  return (
    <TrustPage
      eyebrow="Data coverage"
      title="Know what Jurvio covers."
      introduction="Coverage is a factual product feature. Jurvio publishes the scope, source, and limitations of its public legal data instead of hiding them behind a marketing number."
      sections={[
        {
          title: "Current launch coverage",
          paragraphs: [
            "Jurvio is beginning with United States federal opinions and selected federal docket information obtained from public and authorized sources. Coverage expands in measured batches after source, normalization, privacy, and publication checks pass.",
            "A record appearing on Jurvio does not mean every filing or event in the underlying matter is available. The official court record remains authoritative.",
          ],
        },
        {
          title: "How coverage will be reported",
          paragraphs: [
            "Jurvio will publish verified counts for public cases, opinions, documents, courts, and jurisdictions directly from the production database. Counts will include an as-of time and will not include unpublished drafts.",
            "Jurvio will distinguish case-level records, docket entries, opinions, and documents so that one large number cannot obscure what is actually searchable.",
          ],
        },
        {
          title: "Known limitations",
          paragraphs: [
            "Public legal datasets can be delayed, incomplete, corrected, sealed, or removed at the source. Entity matching can also remain unresolved when the public record does not contain enough identifying information.",
            "Jurvio preserves uncertainty. Missing information is shown as unknown rather than inferred and presented as fact.",
          ],
        },
      ]}
    />
  );
}
