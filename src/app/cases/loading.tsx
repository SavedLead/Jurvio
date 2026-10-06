import styles from "./cases.module.css";

const PLACEHOLDER_ROWS = 6;

export default function LoadingCases() {
  return (
    <main className={styles.page} aria-busy="true">
      <section className={styles.hero}>
        <div className={styles.inner}>
          <div className={styles.heroHeading}>
            <div>
              <h1>Find a federal court case</h1>
              <p>Search source-backed court records by case name, party, docket number, or citation. Every listing links back to the official record.</p>
            </div>
          </div>
          <div className={`${styles.skeleton} ${styles.skeletonSearch}`} />
        </div>
      </section>
      <div className={`${styles.inner} ${styles.layout}`}>
        <div className={styles.skeletonFilters} aria-hidden="true">
          {[0, 1, 2, 3].map((index) => <div key={index} className={`${styles.skeleton} ${styles.skeletonField}`} />)}
        </div>
        <div className={styles.results}>
          <p role="status" className={styles.visuallyHidden}>Loading cases…</p>
          <div className={styles.resultHead} aria-hidden="true">
            <div className={`${styles.skeleton} ${styles.skeletonCount}`} />
          </div>
          <ol className={styles.list} aria-hidden="true">
            {Array.from({ length: PLACEHOLDER_ROWS }, (_, index) => (
              <li key={index}>
                <div className={`${styles.skeleton} ${styles.skeletonMeta}`} />
                <div className={`${styles.skeleton} ${styles.skeletonTitle}`} />
                <div className={`${styles.skeleton} ${styles.skeletonLine}`} />
              </li>
            ))}
          </ol>
        </div>
      </div>
    </main>
  );
}
