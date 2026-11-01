import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { db } from "@/db/client";
import { loadCitationStub, parseStubParam, stubCitingCases } from "@/modules/citations/application/citation-stubs";

// Stub page for a cited case Jurvio does not hold yet (ADR 0090, C9). Always
// noindex/nofollow (even after launch) and never listed in a sitemap. Only
// public facts from the cluster record plus the published, displayable,
// non-sealed Jurvio cases that cite it.
export const dynamic = "force-dynamic";

interface StubPageProps { params: Promise<{ stubId: string }> }

const NOINDEX: Metadata["robots"] = { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } };

export async function generateMetadata({ params }: StubPageProps): Promise<Metadata> {
  const clusterId = parseStubParam((await params).stubId);
  const stub = clusterId ? await loadCitationStub(db(), clusterId) : null;
  return { title: stub?.caseName ? `${stub.caseName} (cited case)` : "Cited case", robots: NOINDEX };
}

export default async function CitedStubPage({ params }: StubPageProps) {
  const clusterId = parseStubParam((await params).stubId);
  if (!clusterId) notFound();
  const sql = db();
  const stub = await loadCitationStub(sql, clusterId);
  if (!stub) notFound();
  if (stub.heldCasePublicId) permanentRedirect(`/case/${stub.heldCasePublicId}` as Route);
  const citing = await stubCitingCases(sql, clusterId);
  return <main className="pageShell">
    <article className="contentSection">
      <p className="eyebrow">Cited case · not yet on Jurvio</p>
      <h1>{stub.caseName}</h1>
      <dl className="caseFacts">
        {stub.citationLabels.length ? <div><dt>Citation</dt><dd>{stub.citationLabels.join("; ")}</dd></div> : null}
        {stub.dateFiled ? <div><dt>Decided</dt><dd>{stub.dateFiled}</dd></div> : null}
      </dl>
      <p>Jurvio has identified this case from citations in published opinions, but its full record is not on Jurvio yet.</p>
    </article>
    {citing.length ? <section className="contentSection citationCaseList">
      <h2>Cited by on Jurvio <span className="citationCount">{citing.length.toLocaleString("en-US")}{citing.length === 50 ? "+" : ""}</span></h2>
      <ul>{citing.map((row) => <li key={row.casePublicId}>
        <Link href={`/case/${row.casePublicId}` as Route}>{row.caption}</Link>
        <small> · {row.courtName}{row.citationLabel ? ` · ${row.citationLabel}` : ""}</small>
      </li>)}</ul>
    </section> : null}
  </main>;
}
