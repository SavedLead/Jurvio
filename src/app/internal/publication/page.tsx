import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { requireInternalPrincipal } from "@/modules/identity/cloudflare-access";
import { listPublicationReviewQueue } from "@/modules/publication/application/list-publication-review-queue";
import { completePublicationReview } from "@/modules/publication/application/publication-review";
import Link from "next/link";
import type { Route } from "next";

export const dynamic = "force-dynamic";

const decisionSchema = z.object({
  reviewId: z.string().uuid(),
  decision: z.enum(["approved", "rejected", "needs_changes"]),
  notes: z.string().trim().max(4000).optional(),
});

async function decidePublication(formData: FormData) {
  "use server";
  const principal = await requireInternalPrincipal(
    db(), await headers(), ["reviewer", "administrator"],
  );
  const input = decisionSchema.parse({
    reviewId: formData.get("reviewId"),
    decision: formData.get("decision"),
    notes: formData.get("notes") || undefined,
  });
  await completePublicationReview(db(), { ...input, reviewerId: principal.id });
  revalidatePath("/internal/publication");
}

export default async function PublicationReviewPage() {
  let principal;
  try {
    principal = await requireInternalPrincipal(db(), await headers(), [
      "viewer", "reviewer", "administrator",
    ]);
  } catch {
    notFound();
  }

  const canDecide = principal.role === "reviewer" || principal.role === "administrator";
  const queue = await listPublicationReviewQueue(db());
  return (
    <main className="shell">
      <p className="eyebrow">Internal controls</p>
      <h1>Publication review</h1>
      <p><Link href={"/internal/analytics" as Route}>Demand analytics</Link></p>
      <p>{queue.length} records require review.</p>
      {queue.length === 0 ? <p>The review queue is clear.</p> : (
        <div className="reviewQueue">
          {queue.map((item) => (
            <article key={item.id}>
              <p className="eyebrow">{item.objectType}</p>
              <h2>{item.label}</h2>
              <p><code>{item.publicId ?? item.objectId}</code></p>
              <p>Risk flags: {JSON.stringify(item.riskFlags)}</p>
              <details>
                <summary>Evidence</summary>
                <pre>{JSON.stringify(item.evidence, null, 2)}</pre>
              </details>
              {canDecide ? (
                <form action={decidePublication}>
                  <input type="hidden" name="reviewId" value={item.id} />
                  <label>Review notes<textarea name="notes" maxLength={4000} /></label>
                  <div>
                    <button name="decision" value="approved">Approve</button>
                    <button name="decision" value="needs_changes">Needs changes</button>
                    <button name="decision" value="rejected">Reject</button>
                  </div>
                </form>
              ) : <p>Read-only access</p>}
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
