import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { requireInternalPrincipal } from "@/modules/identity/cloudflare-access";
import { getCourtFreshness } from "@/modules/operations/application/court-freshness";
import { FreshnessTable } from "./FreshnessTable";

/**
 * Court freshness: one row per tracked federal court (SCOTUS, 13 courts of
 * appeals, 94 district courts). Reads only the precomputed court_freshness and
 * court_source_watermark tables (about 108 + a few hundred rows), so it stays
 * fast regardless of corpus size. Same internal auth as every /internal page.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Court freshness", robots: { index: false, follow: false } };

export default async function CourtFreshnessPage() {
  try {
    await requireInternalPrincipal(db(), await headers(), ["viewer", "reviewer", "administrator"]);
  } catch {
    notFound();
  }
  const snapshot = await getCourtFreshness(db());
  return <FreshnessTable snapshot={snapshot} renderedAt={new Date().toISOString()} />;
}
