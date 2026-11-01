import type { Metadata, Route } from "next";
import Link from "next/link";
import { db } from "@/db/client";
import { listRecentCaseNews } from "@/modules/case-news/application/list-case-news";
import { formatNewsDate } from "@/modules/case-news/ui/case-news-section";
import { cleanCaseCaption } from "@/modules/cases/ui/branded-case-caption";
import "../case/[caseId]/case-intelligence.css";

export const dynamic = "force-dynamic";

// A list of outside links is not original content: keep it out of search
// indexes (follow stays on so the linked case pages are discovered).
export const metadata: Metadata = {
  title: "Cases in the news",
  description: "Recent news coverage of court cases on Jurvio, linked to each case's public record.",
  alternates: { canonical: "/news" },
  robots: { index: false, follow: true },
};

export default async function NewsPage() {
  const links = await listRecentCaseNews(db(), 60).catch(() => []);
  return (
    <main className="shell">
      <p className="eyebrow">Coverage</p>
      <h1>Cases in the news</h1>
      <p className="sectionIntroduction">
        Recent reporting about cases on Jurvio. Each headline links to the publisher; the case link opens the court record.
        Jurvio does not host, write or endorse these articles.
      </p>
      {links.length === 0 ? <p>No recent coverage has been linked yet.</p> : (
        <ul className="caseNewsList">
          {links.map((link) => (
            <li key={link.id}>
              <a className="caseNewsHeadline" href={link.url} rel="nofollow ugc noopener noreferrer" target="_blank">{link.title}</a>
              {link.snippet ? <p className="caseNewsSnippet">{link.snippet}</p> : null}
              <p className="caseNewsMeta">
                <span>{link.outlet}</span>
                <span aria-hidden="true"> · </span>
                <time dateTime={link.publishedAt.slice(0, 10)}>{formatNewsDate(link.publishedAt)}</time>
              </p>
              <p className="caseNewsCase">Case: <Link href={`/case/${link.casePublicId}` as Route}>{cleanCaseCaption(link.caseCaption)}</Link></p>
            </li>
          ))}
        </ul>
      )}
      <p className="sourceNote">News discovered via <a href="https://www.gdeltproject.org/" rel="nofollow noopener">the GDELT Project</a> and Courthouse News Service feeds.</p>
    </main>
  );
}
