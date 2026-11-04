import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { userPlan } from "@/modules/accounts/application/account";
import { planLimits, type PlanId } from "@/modules/accounts/domain/plans";
import { absoluteUrl } from "@/modules/accounts/http/config";
import { currentUser } from "@/modules/accounts/http/session";

export type ProGate =
  | { ok: true; userId: string; plan: PlanId }
  | { ok: false; reason: "signed_out" | "upgrade"; plan: PlanId | null };

/** Emergency-docket Pro tools (analytics, deadline calendar, CSV) are for Pro and Team. No billing here: plans are stubs. */
export async function emergencyProGate(): Promise<ProGate> {
  const user = await currentUser();
  if (!user) return { ok: false, reason: "signed_out", plan: null };
  const plan = await userPlan(db(), user.userId);
  return planLimits(plan).emergencyTools ? { ok: true, userId: user.userId, plan } : { ok: false, reason: "upgrade", plan };
}

/** Redirect for a blocked route handler: sign in first, otherwise the plans page. */
export function proGateRedirect(gate: Extract<ProGate, { ok: false }>, request: Request, next: string) {
  const target = gate.reason === "signed_out" ? `/signin?next=${encodeURIComponent(next)}` : "/pricing?feature=emergency";
  const response = NextResponse.redirect(absoluteUrl(target, new URL(request.url).origin), 303);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = Array.isArray(value) ? value.join("; ") : String(value);
  // Spreadsheet formula injection: a cell must not start with = + - @ (or tab/CR).
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function icsEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Folds an iCalendar content line at 75 octets (RFC 5545 §3.1). */
export function icsFold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest, "utf8") > 75) {
    let cut = 75;
    while (Buffer.byteLength(rest.slice(0, cut), "utf8") > 75) cut -= 1;
    out.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  out.push(rest);
  return out.join("\r\n");
}
