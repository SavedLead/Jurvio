import type { Route } from "next";
import Link from "next/link";
import { PUBLIC_DOCKET_PAGE_SIZE, type PublicDocketEntry } from "@/modules/cases/application/list-public-case-sections";
import { plainDocketText } from "@/modules/cases/domain/docket-text";
import { TermText, type TermMarker } from "@/modules/plain-english/ui/term-text";

export function DocketEntriesSection({
  caseId,
  path,
  title,
  entries,
  total,
  page,
  marker,
}: {
  caseId: string;
  path: "docket" | "timeline";
  title: string;
  entries: PublicDocketEntry[];
  total: number;
  page: number;
  marker: TermMarker;
}) {
  const pages = Math.max(1, Math.ceil(total / PUBLIC_DOCKET_PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PUBLIC_DOCKET_PAGE_SIZE + 1;
  const to = Math.min(total, (page - 1) * PUBLIC_DOCKET_PAGE_SIZE + entries.length);
  const href = (target: number) => `/case/${caseId}/${path}?page=${target}` as Route;
  return (
    <section className="contentSection">
      <p className="sectionKicker">Newest first</p>
      <h2>{title}</h2>
      <p>
        {total.toLocaleString("en-US")} {total === 1 ? "entry" : "entries"}
        {total > 0 ? `, showing ${from.toLocaleString("en-US")}–${to.toLocaleString("en-US")}` : ""}
      </p>
      {entries.length > 0 ? (
        <ol className="recordList">
          {entries.map((entry) => (
            <li key={entry.publicId} id={`entry-${entry.publicId}`}>
              <strong>{entry.entryNumber ? `Entry ${entry.entryNumber}` : "Docket entry"}</strong>
              {entry.filedOn ? <> · <time dateTime={entry.filedOn}>{entry.filedOn}</time></> : null}
              <p><TermText text={plainDocketText(entry.description)} marker={marker} /></p>
            </li>
          ))}
        </ol>
      ) : <p>No docket entries are stored for this case.</p>}
      {pages > 1 ? (
        <nav aria-label="Docket pages">
          {page > 1 ? <Link href={href(page - 1)}>Previous</Link> : null}
          {" "}
          <span>Page {page.toLocaleString("en-US")} of {pages.toLocaleString("en-US")}</span>
          {" "}
          {page < pages ? <Link href={href(page + 1)}>Next</Link> : null}
        </nav>
      ) : null}
    </section>
  );
}
