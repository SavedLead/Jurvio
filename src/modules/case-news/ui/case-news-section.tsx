import type { CaseNewsLink } from "../application/list-case-news";

const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function formatNewsDate(value: string): string {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? dateFormat.format(date) : value;
}

/** "In the news": headline, outlet, date, link and the source's own short snippet. Hidden when empty. */
export function CaseNewsSection({ links }: { links: CaseNewsLink[] }) {
  if (links.length === 0) return null;
  const sources = new Set(links.map((link) => link.source));
  return (
    <section className="contentSection caseFeatureSection caseNews" aria-labelledby="case-news">
      <div className="featureHeading">
        <div><p className="sectionKicker">Coverage</p><h2 id="case-news">In the news</h2></div>
      </div>
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
          </li>
        ))}
      </ul>
      <p className="sourceNote">
        Links to outside reporting about this case. Jurvio does not host, write or endorse these articles.
        {sources.has("gdelt") ? <> Discovered via <a href="https://www.gdeltproject.org/" rel="nofollow noopener">the GDELT Project</a>.</> : null}
      </p>
    </section>
  );
}
