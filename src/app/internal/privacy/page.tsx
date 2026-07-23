import type { Route } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { requireInternalPrincipal } from "@/modules/identity/cloudflare-access";
import { listPrivacyRequests } from "@/modules/privacy/application/list-privacy-requests";
import { approvePrivacyAction, decidePrivacyRequest, updatePrivacyVerification } from "@/modules/privacy/application/review-privacy-request";
import styles from "./privacy.module.css";

export const dynamic = "force-dynamic";

const verifySchema = z.object({ requestId: z.string().uuid(), status: z.enum(["pending", "verified", "failed", "expired"]), provider: z.string().trim().max(120).optional(), reference: z.string().trim().max(300).optional(), reason: z.string().trim().min(1).max(2000) });
const decisionSchema = z.object({ requestId: z.string().uuid(), decision: z.enum(["approved", "partially_approved", "rejected"]), notes: z.string().trim().min(1).max(4000) });
const actionSchema = z.object({ actionId: z.string().uuid(), reason: z.string().trim().min(1).max(2000) });

async function reviewer() {
  return requireInternalPrincipal(db(), await headers(), ["reviewer", "administrator"]);
}

async function updateVerification(formData: FormData) {
  "use server";
  const principal = await reviewer();
  const input = verifySchema.parse(Object.fromEntries(formData));
  await updatePrivacyVerification(db(), { ...input, actorId: principal.id });
  revalidatePath("/internal/privacy");
}

async function decide(formData: FormData) {
  "use server";
  const principal = await reviewer();
  const input = decisionSchema.parse(Object.fromEntries(formData));
  await decidePrivacyRequest(db(), { ...input, actorId: principal.id });
  revalidatePath("/internal/privacy");
}

async function approveAction(formData: FormData) {
  "use server";
  const principal = await reviewer();
  const input = actionSchema.parse(Object.fromEntries(formData));
  await approvePrivacyAction(db(), { ...input, actorId: principal.id });
  revalidatePath("/internal/privacy");
}

export default async function PrivacyOperationsPage() {
  let principal;
  try { principal = await requireInternalPrincipal(db(), await headers(), ["viewer", "reviewer", "administrator"]); } catch { notFound(); }
  const queue = await listPrivacyRequests(db());
  const canReview = principal.role === "reviewer" || principal.role === "administrator";

  return <main className={styles.page}>
    <header className={styles.hero}><div><p className={styles.eyebrow}>Trust operations</p><h1>Privacy request queue</h1><p>Identity review, abuse signals, remedies, and audit state—without storing raw identity documents.</p></div><Link href={"/internal/governance" as Route}>Governance dashboard</Link></header>
    <section className={styles.guardrails}><article><strong>No raw ID</strong><span>Only an opaque verification-provider reference belongs in Jurvio.</span></article><article><strong>Two-person remedy gate</strong><span>The person proposing a mask cannot approve it.</span></article><article><strong>No deletion path</strong><span>Source records remain intact; display remedies are reversible.</span></article><article><strong>No automatic execution</strong><span>Approval does not apply a mask, redirect, or noindex rule.</span></article></section>
    <section className={styles.queue}><div className={styles.heading}><h2>Open requests</h2><span>{queue.length}</span></div>
      {queue.length ? queue.map((item) => <article key={item.id} className={styles.request}>
        <div className={styles.requestHead}><div><span className={styles.status}>{item.status.replaceAll("_", " ")}</span><h3>{item.publicId}</h3><p>{item.requesterType.replaceAll("_", " ")} · submitted {new Date(item.submittedAt).toLocaleString()}</p></div><div className={styles.metrics}><span><strong>{item.targetCount}</strong> targets</span><span><strong>{item.proposedActionCount}</strong> proposed remedies</span><span className={item.highRiskSignalCount ? styles.risk : ""}><strong>{item.highRiskSignalCount}</strong> high-risk signals</span></div></div>
        <div className={styles.verification}><strong>Identity: {item.identityStatus.replaceAll("_", " ")}</strong><span>Assigned: {item.assignedTo ?? "unassigned"}</span><span>Latest audit: {item.latestEventAt ? new Date(item.latestEventAt).toLocaleString() : "none"}</span></div>
        {canReview ? <div className={styles.forms}>
          <form action={updateVerification}><input type="hidden" name="requestId" value={item.id}/><h4>Verification review</h4><label>Status<select name="status" defaultValue="pending"><option value="pending">Pending</option><option value="verified">Verified</option><option value="failed">Failed</option><option value="expired">Expired</option></select></label><label>Provider<input name="provider" placeholder="Approved verification provider"/></label><label>Opaque reference<input name="reference" placeholder="Never paste ID data"/></label><label>Reason<textarea name="reason" required/></label><button>Record verification state</button></form>
          <form action={decide}><input type="hidden" name="requestId" value={item.id}/><h4>Request decision</h4><label>Decision<select name="decision"><option value="approved">Approve</option><option value="partially_approved">Partially approve</option><option value="rejected">Reject</option></select></label><label>Decision notes<textarea name="notes" required/></label><button>Record manual decision</button></form>
        </div> : <p className={styles.readOnly}>Read-only access. Reviewer or administrator role is required to record a decision.</p>}
        {canReview && item.proposedActionCount ? <details className={styles.actionGate}><summary>Second-reviewer remedy approval</summary><p>Enter the specific proposed action UUID from the reviewed evidence packet. Approval does not execute the remedy.</p><form action={approveAction}><input name="actionId" required placeholder="Proposed action UUID"/><input name="reason" required placeholder="Approval reason"/><button>Approve—not apply—remedy</button></form></details> : null}
      </article>) : <div className={styles.empty}><h3>The privacy queue is clear.</h3><p>No submitted, verification-pending, in-review, or unresolved requests are present.</p></div>}
    </section>
  </main>;
}
