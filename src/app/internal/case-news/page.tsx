import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import type { Route } from "next";
import { z } from "zod";
import { db } from "@/db/client";
import { requireInternalPrincipal } from "@/modules/identity/cloudflare-access";
import { decideCaseNewsLink, listCaseNewsReviewQueue } from "@/modules/case-news/application/list-case-news";

export const dynamic = "force-dynamic";

const decisionSchema = z.object({ id: z.string().uuid(), decision: z.enum(["approved", "rejected"]) });

async function decide(formData: FormData) {
  "use server";
  const principal = await requireInternalPrincipal(db(), await headers(), ["reviewer", "administrator"]);
  const input = decisionSchema.parse({ id: formData.get("id"), decision: formData.get("decision") });
  await decideCaseNewsLink(db(), { ...input, reviewer: principal.email });
  revalidatePath("/internal/case-news");
}

export default async function CaseNewsReviewPage() {
  let principal;
  try {
    principal = await requireInternalPrincipal(db(), await headers(), ["viewer", "reviewer", "administrator"]);
  } catch {
    notFound();
  }
  const canDecide = principal.role === "reviewer" || principal.role === "administrator";
  const queue = await listCaseNewsReviewQueue(db());
  return (
    <main className="shell">
      <p className="eyebrow">Internal controls</p>
      <h1>Case news review</h1>
      <p>Medium-confidence matches (score 0.60–0.85). Approved links appear on the case page; rejected links never do.</p>
      <p>{queue.length} links waiting.</p>
      {queue.length === 0 ? <p>The queue is clear.</p> : (
        <div className="reviewQueue">
          {queue.map((item) => (
            <article key={item.id}>
              <p className="eyebrow">{item.matchMethod.replaceAll("_", " ")} · score {item.matchScore.toFixed(3)} · {item.source}</p>
              <h2><a href={item.url} rel="nofollow noopener noreferrer" target="_blank">{item.title}</a></h2>
              <p>{item.outlet} · {item.publishedAt.slice(0, 10)}</p>
              <p>Case: <Link href={`/case/${item.casePublicId}` as Route}>{item.caseCaption}</Link> ({item.courtCode})</p>
              <details><summary>Evidence</summary><pre>{JSON.stringify(item.matchEvidence, null, 2)}</pre></details>
              {canDecide ? (
                <form action={decide}>
                  <input type="hidden" name="id" value={item.id} />
                  <button name="decision" value="approved">Approve</button>
                  <button name="decision" value="rejected">Reject</button>
                </form>
              ) : <p>Read-only access</p>}
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
