import { NextResponse } from "next/server";
import { db } from "@/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db()`SELECT 1`;

    return NextResponse.json({
      status: "ready",
      service: "jurvio-web",
      time: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      {
        status: "not_ready",
        service: "jurvio-web",
        time: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
