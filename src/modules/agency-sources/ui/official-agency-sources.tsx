import type { CaseAgencyItem } from "../application/public-items";
import { DISTRICT_COURTS } from "../domain/federal-courts";

const KIND_LABEL: Record<string, string> = {
  press_release: "Press release", litigation_release: "Litigation release", case_page: "Case page",
  settlement_notice: "Settlement website", settlement_listing: "Settlement administrator listing",
};

function dateLabel(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "America/New_York" }).format(new Date(value));
}

/**
 * Official government and settlement-administrator sources that state this case's court
 * and docket number. Every item names its publisher and links the original.
 */
export function OfficialAgencySources({ items }: { items: CaseAgencyItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className="contentSection caseFeatureSection" aria-labelledby="official-agency-sources">
      <div className="featureHeading">
        <div><p className="sectionKicker">Official public sources</p><h2 id="official-agency-sources">Agency announcements and filings</h2></div>
      </div>
      <p className="sourceNote">
        These official documents state this case&apos;s court and docket number. They are the publisher&apos;s own words;
        allegations are not findings of liability or guilt, and the court record controls.
      </p>
      <ul className="documentCards">
        {items.map((item) => {
          const court = DISTRICT_COURTS.get(item.courtCode);
          const published = dateLabel(item.publishedAt);
          return (
            <li key={item.sourceUrl}>
              <div>
                <span className="documentType">{KIND_LABEL[item.itemKind] ?? item.itemKind.replaceAll("_", " ")}</span>
                <h3>{item.title}</h3>
                <p className="sourceNote">
                  Source: {item.publisher}{item.issuingOffice ? ` (${item.issuingOffice})` : ""}{published ? `, ${published}` : ""}.
                  {" "}States No. {item.docketNumber}{court ? ` (${court.abbreviation})` : ""}.
                </p>
                {item.officialExcerpt ? <blockquote cite={item.sourceUrl}>{item.officialExcerpt}</blockquote> : null}
                {item.settlementAmount ? <p>Settlement amount stated: {item.settlementAmount}</p> : null}
                {item.keyDates.length > 0 ? (
                  <ul>{item.keyDates.map((date) => <li key={`${date.label}:${date.date}`}>{date.label}: <time dateTime={date.date}>{date.date}</time></li>)}</ul>
                ) : null}
                {item.documents.length > 0 ? (
                  <ul>{item.documents.slice(0, 8).map((document) => (
                    <li key={document.url}><a href={document.url} rel="nofollow noopener">{document.label}</a></li>
                  ))}</ul>
                ) : null}
              </div>
              <div className="documentActions">
                <a href={item.sourceUrl} rel="nofollow noopener">Official source ↗</a>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
