import type { Metadata } from "next";
import { TrustPage } from "@/modules/trust/ui/trust-page";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Jurvio handles visitor information, analytics, public-record data, and privacy requests.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return <TrustPage
    eyebrow="Privacy"
    title="Privacy without surveillance."
    introduction="Jurvio minimizes visitor data and keeps public-record publishing separate from user tracking."
    sections={[
      { title: "Information Jurvio processes", paragraphs: [
        "Jurvio processes ordinary technical request information needed to deliver and secure the site, which may include IP address, browser type, requested path, timestamps, and security or error logs.",
        "If you contact Jurvio, we process the information you provide so we can respond. Jurvio does not currently offer public customer accounts, subscriptions, or payments.",
      ]},
      { title: "Privacy-safe analytics", paragraphs: [
        "When analytics is enabled, Jurvio records limited page-view events using generalized route templates rather than names, search terms, case identifiers, or page text. Autocapture and session recording are disabled, text and attributes are masked, Do Not Track is respected, and analytics state is kept in memory.",
        "Jurvio uses service providers only as needed to operate, secure, measure, and improve the service. Jurvio does not sell personal information.",
      ]},
      { title: "Public legal records", paragraphs: [
        "Court records and related public-source information appearing on Jurvio are publication content, not visitor-tracking data. Jurvio applies separate sourcing, verification, privacy, correction, restriction, and suppression controls to that material.",
        "To request a correction or raise a privacy concern about published material, email legal@jurvio.com with the Jurvio URL and supporting documentation.",
      ]},
      { title: "Retention and requests", paragraphs: [
        "Jurvio retains operational, security, correspondence, and analytics information only as reasonably needed for the purpose collected, legal obligations, dispute resolution, and protection of the service.",
        "Questions and privacy requests may be sent to legal@jurvio.com. This policy is effective September 16, 2026 and may be updated as Jurvio adds accounts, payments, or other features.",
      ]},
    ]}
  />;
}
