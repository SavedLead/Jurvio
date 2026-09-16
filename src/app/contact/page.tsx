import type { Metadata } from "next";
import { TrustPage } from "@/modules/trust/ui/trust-page";

export const metadata: Metadata = {
  title: "Contact Jurvio",
  description: "Contact Jurvio about legal records, corrections, privacy, sources, or general questions.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return <TrustPage
    eyebrow="Contact"
    title="Reach the right Jurvio desk."
    introduction="Include the relevant Jurvio URL whenever your question concerns a case, person, court, or document."
    sections={[
      { title: "Records, corrections, and privacy", paragraphs: [
        "Email legal-records@jurvio.com for factual corrections, sealing or expungement documentation, identity concerns, source questions, privacy concerns, and requests involving a published record.",
        "Include the exact Jurvio URL, explain what you believe is incorrect or restricted, and attach or link to authoritative supporting material. Do not send Social Security numbers, full financial-account numbers, or unnecessary sensitive documents.",
      ]},
      { title: "General questions", paragraphs: [
        "General questions about Jurvio may also be sent to legal-records@jurvio.com until separate support channels are introduced.",
        "Jurvio cannot provide legal advice, recommend what to file, interpret a deadline for you, or contact a court on your behalf.",
      ]},
      { title: "Security reports", paragraphs: [
        "If you believe you found a security issue, email legal-records@jurvio.com with a concise description and steps to reproduce it. Do not access, alter, download, or retain data that is not yours.",
      ]},
    ]}
  />;
}
