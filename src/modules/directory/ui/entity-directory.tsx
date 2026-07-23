import Link from "next/link";
import type { Route } from "next";
import type { DirectoryEntitySummary } from "../application/public-directory";
import styles from "./directory.module.css";

export function EntityDirectory({
  records, hrefPrefix, emptyTitle, emptyDescription,
}: {
  records: DirectoryEntitySummary[];
  hrefPrefix: "/parties" | "/law-firms";
  emptyTitle: string;
  emptyDescription: string;
}) {
  if (!records.length) return <section className={styles.empty}><h2>{emptyTitle}</h2><p>{emptyDescription}</p></section>;
  return <ol className={styles.list}>{records.map((record) => (
    <li key={record.publicId}>
      <Link className={styles.card} href={`${hrefPrefix}/${record.publicId}` as Route}>
        <h2>{record.displayName}</h2>
        <dl><div><dt>Public cases</dt><dd>{record.caseCount.toLocaleString()}</dd></div>
          <div><dt>Latest filing</dt><dd>{record.latestCaseDate ?? "Date unavailable"}</dd></div></dl>
      </Link>
    </li>
  ))}</ol>;
}
