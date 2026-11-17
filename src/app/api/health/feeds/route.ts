import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { readLiveFeedHealth } from "@/modules/ingestion/application/live-feed-health";

export const dynamic = "force-dynamic";

/** Public ages only. No captions, docket numbers, or database errors. */
export async function GET() {
  try {
    const health = await readLiveFeedHealth(db());
    return NextResponse.json(health, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json(
      { generatedAt: new Date().toISOString(), courtHours: false, ok: false, district: null, appeals: null },
      { status: 200, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
