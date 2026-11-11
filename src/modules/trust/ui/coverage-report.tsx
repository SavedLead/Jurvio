import { formatEasternDateTime } from "@/lib/time/eastern";
import {
  describeBlocker,
  coverageThroughLabel,
  type CoverageSnapshot,
} from "@/modules/trust/application/get-coverage-snapshot";
import styles from "./coverage-report.module.css";

/**
 * Renders live coverage facts, including the gaps.
 *
 * Every number here is read from the published corpus at request time. Where a
 * section cannot be read, it says so rather than falling back to prose that
 * implies coverage Jurvio does not have.
 */
export function CoverageReport({ snapshot }: { snapshot: CoverageSnapshot }) {
  const { corpus, families, limitations } = snapshot;
  const count = (value: number) => value.toLocaleString("en-US");

  return (
    <div className={styles.report}>
      <p className={styles.asOf}>
        {snapshot.publishedCasesApproximate ? (
          <>
            The published-case total is a planner estimate as of{" "}
            <strong>{formatEasternDateTime(snapshot.checkedAt)}</strong>. Per-court totals stay
            off this page until every court has been seeded, so a partial seed is not shown as
            the corpus.
          </>
        ) : (
          <>
            Measured from precomputed per-court totals as of{" "}
            <strong>{formatEasternDateTime(snapshot.checkedAt)}</strong>. The published-case total is
            the sum of the family rows. These figures can lag new publication. Draft, held, and
            suppressed records are excluded.
          </>
        )}
      </p>

      {corpus ? (
        <dl className={styles.totals}>
          <div>
            <dt>Published cases</dt>
            <dd>{count(corpus.publishedCases)}</dd>
          </div>
          <div>
            <dt>Published opinions</dt>
            <dd>{corpus.publishedOpinions === null ? "Not available" : count(corpus.publishedOpinions)}</dd>
          </div>
          <div>
            <dt>Courts with records</dt>
            <dd>{corpus.courtsWithRecords === null ? "Not available" : count(corpus.courtsWithRecords)}</dd>
          </div>
          <div>
            <dt>Filing years covered</dt>
            <dd>{coverageThroughLabel(corpus.earliestFiledOn, corpus.latestFiledOn)}</dd>
          </div>
          <div>
            <dt>Most recent source retrieval</dt>
            <dd>
              {corpus.lastSourceRetrievedAt
                ? formatEasternDateTime(corpus.lastSourceRetrievedAt)
                : "Unknown"}
            </dd>
          </div>
        </dl>
      ) : (
        <p className={styles.unavailable}>
          Live corpus totals are temporarily unavailable. Rather than show a number Jurvio cannot
          verify right now, this section is left blank.
        </p>
      )}

      {families ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption>
              Coverage by court family. “Courts covered” counts courts with at least one published
              case, against the courts Jurvio tracks — so a partial roster is visible as a partial
              roster.
            </caption>
            <thead>
              <tr>
                <th scope="col">Court family</th>
                <th scope="col" className={styles.numeric}>Courts covered</th>
                <th scope="col" className={styles.numeric}>Published cases</th>
                <th scope="col" className={styles.numeric}>Filing years</th>
              </tr>
            </thead>
            <tbody>
              {families.map((family) => {
                const partial =
                  family.courtsTracked !== null && family.courtsWithRecords < family.courtsTracked;
                return (
                  <tr key={family.key}>
                    <th scope="row">{family.name}</th>
                    <td className={`${styles.numeric} ${partial ? styles.partial : ""}`}>
                      {family.courtsTracked === null
                        ? count(family.courtsWithRecords)
                        : `${count(family.courtsWithRecords)} of ${count(family.courtsTracked)}`}
                    </td>
                    <td className={styles.numeric}>{count(family.publishedCases)}</td>
                    <td className={styles.numeric}>
                      {coverageThroughLabel(family.earliestFiledOn, family.latestFiledOn)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={styles.unavailable}>
          Per-court coverage is temporarily unavailable.
        </p>
      )}

      {limitations ? (
        <ul className={styles.gaps}>
          {snapshot.publishedCasesApproximate ? null : (
            <li>
              <strong>District court coverage is incomplete.</strong>{" "}
              {count(limitations.districtsWithoutRecords)} of the district courts Jurvio tracks have no
              published records yet, and {count(limitations.districtsLiveMonitored)} are on a live
              source feed. A case absent from Jurvio is not evidence that no such case exists.
            </li>
          )}
          {limitations.heldForReview > 0 ? (
            <li>
              <strong>{limitations.heldApproximate ? "About " : ""}{count(limitations.heldForReview)} collected records are waiting for a quality check</strong>{" "}
              and are deliberately not published. Records stay unpublished until they pass Jurvio’s
              publication and privacy checks.
            </li>
          ) : null}
          {limitations.blockedDocuments.map((blocked) => (
            <li key={blocked.reason}>
              <strong>{count(blocked.count)} source documents are not readable on Jurvio.</strong>{" "}
              {describeBlocker(blocked.reason)}. The underlying document remains available from the
              court or the original source.
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.unavailable}>Known-gap figures are temporarily unavailable.</p>
      )}
    </div>
  );
}
