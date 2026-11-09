import { formatPublicCaseDate } from "@/modules/cases/domain/scotus-display";
import type { ScotusPublicRecord } from "@/modules/scotus/application/public-case-record";

const SIDE: Record<string, string> = {
  petitioner: "Petitioner",
  respondent: "Respondent",
  other: "Other",
};

function when(value: string | null): string | null {
  if (!value) return null;
  return formatPublicCaseDate(value) ?? value;
}

export function ScotusCaseRecord({ record }: { record: ScotusPublicRecord }) {
  const facts = record.facts;
  const rows: Array<[string, string]> = [];
  if (facts.petitioner) rows.push(["Petitioner", facts.petitioner]);
  if (facts.respondent) rows.push(["Respondent", facts.respondent]);
  if (facts.lowerCourt) rows.push(["Lower court", facts.lowerCourt]);
  if (facts.lowerCaseNumbers.length) rows.push(["Lower-court numbers", facts.lowerCaseNumbers.join(", ")]);
  if (facts.docketedOn) rows.push(["Docketed", when(facts.docketedOn) ?? facts.docketedOn]);
  if (facts.lowerCourtDecidedOn) rows.push(["Lower court decided", when(facts.lowerCourtDecidedOn) ?? facts.lowerCourtDecidedOn]);
  if (facts.arguedOn) rows.push(["Argued", when(facts.arguedOn) ?? facts.arguedOn]);
  if (facts.rearguedOn) rows.push(["Reargued", when(facts.rearguedOn) ?? facts.rearguedOn]);
  if (facts.certStatus) rows.push(["Certiorari", [facts.certStatus, when(facts.certStatusOn)].filter(Boolean).join(" · ")]);
  if (facts.judgmentOn) rows.push(["Judgment", when(facts.judgmentOn) ?? facts.judgmentOn]);
  if (facts.lastEntryOn) rows.push(["Latest docket entry", when(facts.lastEntryOn) ?? facts.lastEntryOn]);
  const filingNote = facts.filingCount > record.filings.length
    ? `Showing ${record.filings.length.toLocaleString("en-US")} of ${facts.filingCount.toLocaleString("en-US")} filing links.`
    : null;
  const orderNote = facts.orderCount > record.orders.length
    ? `Showing ${record.orders.length.toLocaleString("en-US")} of ${facts.orderCount.toLocaleString("en-US")} order-list items.`
    : null;
  return (
    <section className="contentSection" aria-label="Supreme Court record">
      <p className="sectionKicker">Supreme Court</p>
      <h2>Docket record</h2>
      {facts.sourceUrl ? <p><a href={facts.sourceUrl}>Official docket on supremecourt.gov</a></p> : null}
      {rows.length > 0 ? (
        <dl className="caseMeta">
          {rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
      ) : null}
      {record.counsel.length > 0 ? (
        <>
          <h3>Counsel</h3>
          <ul className="recordList">
            {record.counsel.map((person) => (
              <li key={`${person.side}:${person.name}`}>
                <strong>{SIDE[person.side] ?? person.side}</strong>
                {" · "}{person.name}
                {person.counselOfRecord ? " · counsel of record" : ""}
                {person.firm ? ` · ${person.firm}` : ""}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {record.filings.length > 0 ? (
        <>
          <h3>Filings linked from the Court</h3>
          {filingNote ? <p>{filingNote}</p> : null}
          <ul className="recordList">
            {record.filings.map((filing) => (
              <li key={filing.sourceUrl}>
                {filing.filedOn ? <time dateTime={filing.filedOn}>{when(filing.filedOn)}</time> : null}
                {" "}
                <a href={filing.sourceUrl}>{filing.description?.trim() || "Court filing"}</a>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {record.orders.length > 0 ? (
        <>
          <h3>Order lists</h3>
          {orderNote ? <p>{orderNote}</p> : null}
          <ul className="recordList">
            {record.orders.map((order) => (
              <li key={`${order.listDate}:${order.label}:${order.disposition ?? order.body ?? ""}`}>
                <time dateTime={order.listDate}>{when(order.listDate)}</time>
                {" · "}
                <a href={order.sourceUrl}>{order.label}</a>
                {order.disposition ? <p>{order.disposition}</p> : null}
                {order.body ? <p>{order.body}</p> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
