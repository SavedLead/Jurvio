import type { Metadata } from "next";
import { TrustPage } from "@/modules/trust/ui/trust-page";

export const metadata: Metadata = {
  title: "Terms of Use",
  description: "Terms governing use of Jurvio's public legal-information service.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return <TrustPage
    eyebrow="Terms of use"
    title="Use Jurvio as information, not legal advice."
    introduction="These terms govern use of Jurvio's public website and legal-information features."
    sections={[
      { title: "Informational service", paragraphs: [
        "Jurvio provides public-record information and general legal education. Jurvio is not a court or law firm, does not represent users, and does not provide legal advice. Using Jurvio does not create an attorney-client relationship.",
        "Court records can be delayed, incomplete, corrected, sealed, or removed. The official court record controls. Users should verify important information with the court or qualified counsel.",
      ]},
      { title: "Responsible use", paragraphs: [
        "You may use public Jurvio pages for lawful research and personal or professional information purposes. You may not disrupt the service, bypass access controls, probe private systems, introduce malicious code, impersonate another person, or use Jurvio to harass, discriminate, or make unlawful eligibility decisions.",
        "Automated access must respect published technical controls and must not impair service for others. Private command-center routes and credentials are not part of the public service.",
      ]},
      { title: "Content and availability", paragraphs: [
        "Jurvio may correct, update, restrict, or remove material and may change or discontinue features. Descriptions, summaries, status explanations, and connections may contain errors even when source-backed.",
        "The service is provided as available without a promise that every record, court, feature, or page will always be complete, current, uninterrupted, or error-free.",
      ]},
      { title: "Requests and updates", paragraphs: [
        "Report an error, privacy concern, or rights issue to legal@jurvio.com and include the relevant Jurvio URL and supporting information.",
        "These terms are effective September 16, 2026. Jurvio may update them as the service develops, including before accounts, subscriptions, or paid features are introduced.",
      ]},
    ]}
  />;
}
