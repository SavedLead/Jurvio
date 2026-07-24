import type { Metadata } from "next";
import { TrustPage } from "@/modules/trust/ui/trust-page";

export const metadata: Metadata = {
  title: "Editorial Standards",
  description: "Jurvio standards for neutrality, sourcing, authorship, corrections, and responsible automation.",
};

export default function EditorialStandardsPage() {
  return (
    <TrustPage
      eyebrow="Editorial standards"
      title="Explain the law without taking sides."
      introduction="Jurvio’s job is to help readers understand the record, not to advocate for a party or turn allegations into conclusions."
      sections={[
        {
          title: "Neutrality and attribution",
          paragraphs: [
            "Allegations are attributed to the party or source making them. A complaint is not treated as proof, an arrest is not a conviction, and a procedural ruling is not described as a decision on the merits unless the record supports that conclusion.",
            "Jurvio distinguishes court holdings, party arguments, procedural events, and Jurvio-created explanations.",
          ],
        },
        {
          title: "Authorship and review",
          paragraphs: [
            "Jurvio does not invent staff, credentials, quotations, reviews, or firsthand reporting. Organizational material may be attributed to Jurvio Editorial. A named reviewer is displayed only when a real person has completed the stated review.",
            "Meaningful automation may assist research, organization, and drafting, but publication standards apply regardless of how material was produced.",
          ],
        },
        {
          title: "Corrections",
          paragraphs: [
            "Jurvio corrects material errors and records significant revisions. Source corrections, amended court records, identity errors, and privacy requests are evaluated using documented procedures.",
            "Readers should be able to identify the supporting source and report a problem from the page where it appears.",
          ],
        },
      ]}
    />
  );
}
