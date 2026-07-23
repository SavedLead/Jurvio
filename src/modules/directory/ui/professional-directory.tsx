import Link from "next/link";
import type { Route } from "next";
import type { AttorneySummary, LawFirmSummary, ProfessionalContact } from "../application/professional-directory";
import styles from "./directory.module.css";

export function AttorneyDirectory({ records }: { records: AttorneySummary[] }) {
  if (!records.length) return <section className={styles.empty}><h2>No attorney profiles are published yet</h2>
    <p>Jurvio publishes an attorney only after an authoritative source verifies the identity and a qualifying court record supports the case relationship.</p></section>;
  return <ol className={styles.list}>{records.map((record) => <li key={record.publicId}>
    <Link className={styles.card} href={`/attorneys/${record.publicId}` as Route}><h2>{record.displayName}</h2><dl>
      <div><dt>Published cases</dt><dd>{record.caseCount.toLocaleString()}</dd></div>
      <div><dt>Latest filing</dt><dd>{record.latestCaseDate ?? "Date unavailable"}</dd></div>
    </dl></Link>
  </li>)}</ol>;
}

export function LawFirmDirectory({ records }: { records: LawFirmSummary[] }) {
  if (!records.length) return <section className={styles.empty}><h2>No law-firm profiles are published yet</h2>
    <p>Jurvio publishes a firm only after verified professional sources and qualifying court records support the identity and case relationships.</p></section>;
  return <ol className={styles.list}>{records.map((record) => <li key={record.publicId}>
    <Link className={styles.card} href={`/law-firms/${record.publicId}` as Route}><h2>{record.displayName}</h2><dl>
      <div><dt>Published cases</dt><dd>{record.caseCount.toLocaleString()}</dd></div>
      <div><dt>Latest filing</dt><dd>{record.latestCaseDate ?? "Date unavailable"}</dd></div>
    </dl></Link>
  </li>)}</ol>;
}

export function ContactDetails({ contacts }: { contacts: ProfessionalContact[] }) {
  if (!contacts.length) return <p className={styles.muted}>No verified professional contact details are published.</p>;
  return <dl className={styles.contactList}>{contacts.map((contact, index) => <div key={`${contact.type}-${contact.value}-${index}`}>
    <dt>{contact.type.replaceAll("_", " ")}</dt><dd>{contact.href
      ? <a href={contact.href} rel="nofollow noopener">{contact.value}</a> : contact.value}
      <small>Verified {contact.verifiedOn} · <a href={contact.sourceUrl} rel="nofollow noopener">source</a></small></dd>
  </div>)}</dl>;
}

export function NeutralFaq({ name, kind, caseCount, latestCaseDate, hasContacts }: {
  name: string; kind: "attorney" | "law firm"; caseCount: number; latestCaseDate: string | null; hasContacts: boolean;
}) {
  const items = [
    { q: `Who is ${name}?`, a: `Jurvio identifies ${name} as a ${kind} in qualifying public professional and court records. This profile does not imply endorsement or misconduct.` },
    { q: `Which published cases are connected to ${name}?`, a: `${caseCount.toLocaleString()} published ${caseCount === 1 ? "case is" : "cases are"} currently connected through sourced court-record relationships.` },
    { q: `When was the latest connected case filed?`, a: latestCaseDate ?? "The filing date is not available in the published source data." },
    { q: `Does Jurvio publish contact information for ${name}?`, a: hasContacts ? "Only contact details verified against an authoritative public professional source are shown above." : "Jurvio has not published verified professional contact information for this profile." },
  ];
  return <section className={styles.section}><h2>Frequently asked questions</h2><div className={styles.faq}>{items.map((item) => <details key={item.q}>
    <summary>{item.q}</summary><p>{item.a}</p>
  </details>)}</div></section>;
}
