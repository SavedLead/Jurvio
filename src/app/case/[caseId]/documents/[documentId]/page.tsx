import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { db } from "@/db/client";
import { getPublicOpinion } from "@/modules/cases/application/get-public-opinion";
import { recordDemandEvent } from "@/modules/demand/application/record-demand-event";

export const dynamic = "force-dynamic";

interface OpinionPageProps {
  params: Promise<{ caseId: string; documentId: string }>;
}

async function load(params: OpinionPageProps["params"]) {
  const { caseId, documentId } = await params;
  if (!/^jv-[a-z0-9]{8,10}$/.test(caseId) || !/^jd-[a-z0-9]{8,10}$/.test(documentId)) {
    return null;
  }
  return getPublicOpinion(db(), caseId, documentId);
}

export async function generateMetadata({ params }: OpinionPageProps): Promise<Metadata> {
  const opinion = await load(params);
  if (!opinion) return { title: "Opinion not found" };
  const description = opinion.contentText.slice(0, 155);
  return {
    title: `${opinion.caseCaption} — Judicial Opinion`,
    description,
    alternates: {
      canonical: `/case/${opinion.casePublicId}/documents/${opinion.documentPublicId}`,
    },
    robots: opinion.indexable ? { index: true, follow: true } : { index: false, follow: true },
  };
}

export default async function OpinionPage({ params }: OpinionPageProps) {
  const opinion = await load(params);
  if (!opinion) notFound();

  const canonicalPath = `/case/${opinion.casePublicId}/documents/${opinion.documentPublicId}`;
  const requestHeaders = await headers();
  await recordDemandEvent(db(), {
    eventType: "document_view",
    userAgent: requestHeaders.get("user-agent"),
    referrer: requestHeaders.get("referer"),
    path: canonicalPath,
    contentKind: "document",
    targetType: "document",
    targetPublicId: opinion.documentPublicId,
  });
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "DigitalDocument",
    name: opinion.title,
    headline: opinion.caseCaption,
    datePublished: opinion.filedOn ?? undefined,
    pagination: `${opinion.wordCount} words`,
    isPartOf: { "@type": "CreativeWork", name: opinion.caseCaption },
    provider: { "@type": "Organization", name: "Jurvio" },
  };

  return (
    <main className="readerShell">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replaceAll("<", "\\u003c") }}
      />
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/cases">Cases</Link> / <Link href={`/case/${opinion.casePublicId}`}>{opinion.caseCaption}</Link> / Opinion
      </nav>
      <article className="opinionLayout">
        <header className="opinionHeader">
          <p className="eyebrow">{opinion.courtName}</p>
          <h1>{opinion.caseCaption}</h1>
          <p className="lede">{opinion.title}</p>
          <dl className="metadataGrid">
            <div><dt>Filed</dt><dd>{opinion.filedOn ?? "Date unavailable"}</dd></div>
            <div><dt>Docket</dt><dd>{opinion.docketNumber}</dd></div>
            <div><dt>Opinion</dt><dd>{opinion.opinionType.replaceAll("-", " ")}</dd></div>
            <div><dt>Status</dt><dd>{opinion.precedentialStatus ?? "Not specified"}</dd></div>
            {opinion.authorName ? <div><dt>Author</dt><dd>{opinion.authorName}</dd></div> : null}
          </dl>
          <aside className="sourceNotice">
            <strong>Source-backed court text.</strong> Jurvio reformats the published opinion for readability; it does not change the court&apos;s words.
            {opinion.sourceDownloadUrl ? <> <a href={opinion.sourceDownloadUrl} rel="nofollow noopener">View source file</a>.</> : null}
          </aside>
        </header>
        <div className="opinionBody" dangerouslySetInnerHTML={{ __html: opinion.contentHtml }} />
      </article>
      <p className="permalink">Permanent Jurvio record: <Link href={canonicalPath as Route}>{opinion.documentPublicId}</Link></p>
    </main>
  );
}
