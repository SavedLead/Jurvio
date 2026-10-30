import type { Route } from "next";
import { redirect } from "next/navigation";

// The old court coverage page moved into the admin backend as the per-court
// freshness table. /internal enforces the same internal auth.
export const dynamic = "force-dynamic";

export default function HeartbeatRedirect() {
  redirect("/internal/freshness" as Route);
}
