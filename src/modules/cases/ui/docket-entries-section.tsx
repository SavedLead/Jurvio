import type { Route } from "next";
import Link from "next/link";
import { PUBLIC_DOCKET_PAGE_SIZE, type PublicDocketEntry } from "@/modules/cases/application/list-public-case-sections";
import {
  ALLEGATION_NOTE, DOCKET_FEED_NOTE, docketEntryKind, docketEntryKindLabel, namedParties, statedOutcome,
} from "@/modules/cases/domain/docket-classification";
import { plainDocketText } from "@/modules/cases/domain/docket-text";
import { formatPublicCaseDate } from "@/modules/cases/domain/scotus-display";
import { TermText, type TermMarker } from "@/modules/plain-english/ui/term-text";

export function DocketEntriesSection({
  caseId,
  path,
  title,
  entries,
  total,
  orderCount,
  orders,
  partyNames,
  page,
  marker,
}: {
  caseId: string;
  path: "docket" | "timeline";
  title: string;
  entries: PublicDocketEntry[];
  total: number;
  orderCount: number;
  orders: PublicDocketEntry[];
  partyNames: readonly string[];
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
        {total.toLocaleString("en-US")} {total === 1 ? "entry" : "entries"}, {orderCount.toLocaleString("en-US")} {orderCount === 1 ? "order" : "orders"}
        {total > 0 ? `. Showing ${from.toLocaleString("en-US")}–${to.toLocaleString("en-US")}` : ""}
      </p>
      <p>{DOCKET_FEED_NOTE}</p>
      <p>{ALLEGATION_NOTE}</p>
      {orders.length > 0 ? (
        <>
          <h3>Orders and rulings</h3>
          <p>An outcome is stated only when the entry itself states it.</p>
          <ol className="recordList">
            {orders.map((entry) => {
              const text = plainDocketText(entry.description);
              const outcome = statedOutcome(text);
              const named = namedParties(text, partyNames);
              return (
                <li key={entry.publicId}>
                  {entry.filedOn ? <time dateTime={entry.filedOn}>{formatPublicCaseDate(entry.filedOn) ?? entry.filedOn}</time> : null}
                  {" · "}
                  <strong>{docketEntryKindLabel(docketEntryKind(text))}</strong>
                  {entry.entryNumber ? ` #${entry.entryNumber}` : ""}
                  <p><TermText text={text} marker={marker} /></p>
                  {outcome ? <p>Outcome stated in the entry: {outcome}</p> : null}
                  {named.length > 0 ? <p>Names {named.join(", ")}</p> : null}
                </li>
              );
            })}
          </ol>
        </>
      ) : null}
      {entries.length > 0 ? (
        <ol className="recordList">
          {entries.map((entry) => {
            const text = plainDocketText(entry.description);
            const kind = docketEntryKind(text);
            return (
              <li key={entry.publicId} id={`entry-${entry.publicId}`}>
                <strong>{docketEntryKindLabel(kind)}</strong>
                {entry.entryNumber ? ` · Entry ${entry.entryNumber}` : ""}
                {entry.filedOn ? <> · <time dateTime={entry.filedOn}>{entry.filedOn}</time></> : null}
                <p><TermText text={text} marker={marker} /></p>
              </li>
            );
          })}
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
