import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    service: "jurvio-web",
    time: new Date().toISOString(),
  });
}
