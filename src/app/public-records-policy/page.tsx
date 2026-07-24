import type { Metadata } from "next";
import { TrustPage } from "@/modules/trust/ui/trust-page";

export const metadata: Metadata = {
  title: "Public Records Policy",
  description: "How Jurvio approaches court records, privacy, corrections, redaction, and official sources.",
};

export default function PublicRecordsPolicyPage() {
  return (
    <TrustPage
      eyebrow="Public-records policy"
      title="Public access requires responsible context."
      introduction="Jurvio republishes and organizes eligible public legal information while recognizing that availability, accuracy, privacy, and public interest are separate questions."
      sections={[
        {
          title: "Official records",
          paragraphs: [
            "Jurvio is not the source of a court record and does not replace PACER, a court clerk, or another official repository. Readers should use the official record for filing, deadline, and legal-reliance purposes.",
            "A Jurvio page may contain normalized information, links, and explanations that do not appear in the official interface.",
          ],
        },
        {
          title: "Corrections, privacy, and redaction",
          paragraphs: [
            "Jurvio evaluates requests involving sealed or expunged material, mistaken identity, source corrections, sensitive personal information, and other documented circumstances. Public interest, legal obligations, source status, and harm are considered.",
            "A request is not accepted or rejected solely because a record is public. Jurvio may correct, de-index, redact, relabel, or remove material when appropriate.",
          ],
        },
        {
          title: "Fair process",
          paragraphs: [
            "Requests must identify the affected material and provide enough information to evaluate authority and accuracy. Jurvio limits unnecessary collection of identity documents and protects submitted information.",
            "Jurvio does not promise a particular outcome before reviewing the record and supporting documentation.",
          ],
        },
      ]}
    />
  );
}
