import type { Metadata } from "next";
import { TrustPage } from "@/modules/trust/ui/trust-page";

export const metadata: Metadata = {
  title: "Sources and Methodology",
  description: "How Jurvio sources, normalizes, connects, verifies, and presents public legal information.",
};

export default function MethodologyPage() {
  return (
    <TrustPage
      eyebrow="Sources and methodology"
      title="The source remains part of the answer."
      introduction="Jurvio makes litigation easier to understand without separating an explanation from the public material that supports it."
      sections={[
        {
          title: "Source preservation",
          paragraphs: [
            "Jurvio records source identity, retrieval time, and content integrity information when supported by the provider. Source material and normalized records remain separate so that derived data can be rebuilt and audited.",
            "Public pages link to available source records and identify when Jurvio last verified material.",
          ],
        },
        {
          title: "Deterministic before generative",
          paragraphs: [
            "Dates, court identifiers, parties, docket sequence, citations, and procedural status are normalized with rules wherever possible. Automated language tools are not allowed to decide publication, privacy, identity, or current case status.",
            "Plain-language material must remain qualified, source-grounded, and visibly separate from the official record.",
          ],
        },
        {
          title: "Connections and identity",
          paragraphs: [
            "Jurvio connects qualified entities across cases while preserving source-specific identities. Similar names alone are not enough to declare that two people are the same person.",
            "When available evidence is insufficient, Jurvio keeps records separate or labels the relationship as unresolved.",
          ],
        },
      ]}
    />
  );
}
