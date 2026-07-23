export type GovernmentLeadStatus = "discovered" | "matched" | "reviewed" | "published" | "rejected";

export interface GovernmentLeadPublicationInput {
  reviewStatus: GovernmentLeadStatus;
  reviewedAt: string | null;
  publishedAt: string | null;
  sourceUrl: string;
  attributedSummary: string;
}

export function isGovernmentLeadPublic(input: GovernmentLeadPublicationInput): boolean {
  if (input.reviewStatus !== "published" || !input.reviewedAt || !input.publishedAt) return false;
  if (!input.sourceUrl.startsWith("https://")) return false;
  return input.attributedSummary.trim().length > 0;
}

export function allegationNotice(agencyName: string): string {
  return `This page reports what ${agencyName} said in an official source. Allegations are not findings of liability or guilt.`;
}
