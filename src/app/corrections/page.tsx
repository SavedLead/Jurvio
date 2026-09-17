import type { Metadata } from "next";
import { TrustPage } from "@/modules/trust/ui/trust-page";

export const metadata: Metadata = {
  title: "Corrections and Record Requests",
  description: "How to request a factual correction or raise a privacy or publication concern with Jurvio.",
  alternates: { canonical: "/corrections" },
};

export default function CorrectionsPage() {
  return <TrustPage
    eyebrow="Corrections"
    title="Make the record more accurate."
    introduction="Jurvio reviews specific, documented concerns about factual accuracy, identity, privacy, sealing, and publication status."
    sections={[
      { title: "What to send", paragraphs: [
        "Email legal@jurvio.com with the exact Jurvio URL, the specific statement or field at issue, the correction you believe is required, and an authoritative source supporting the request.",
        "Helpful sources include an official docket entry, court order, corrected opinion, source-agency page, or identity documentation limited to what is necessary. Please redact unrelated sensitive information.",
      ]},
      { title: "How Jurvio reviews requests", paragraphs: [
        "Jurvio checks the request against available official or authoritative sources and its publication rules. Depending on the evidence, Jurvio may correct a field, add context, separate identities, restrict a record, suppress material, or explain why no change was made.",
        "A request does not automatically establish that public-source information is inaccurate or legally restricted. Jurvio preserves an audit trail of publication decisions and material corrections.",
      ]},
      { title: "Sealed, expunged, or restricted records", paragraphs: [
        "For a sealing, expungement, or restriction request, provide the relevant signed order or an official docket source showing the restriction. Jurvio will verify the order and evaluate all affected pages and machine-readable records.",
        "Do not send more personal information than is needed to identify the record and verify the request.",
      ]},
      { title: "What Jurvio cannot do", paragraphs: [
        "Jurvio cannot change the official court record, provide legal advice, file papers, or guarantee removal from search engines or unrelated websites.",
        "Urgent safety concerns should be clearly identified in the subject line, but email is not an emergency service.",
      ]},
    ]}
  />;
}
