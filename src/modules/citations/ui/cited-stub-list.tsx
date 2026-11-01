import Link from "next/link";
import type { CitedStub } from "../application/citation-stubs";
import { stubPath } from "../application/citation-stubs";

/** "Cited cases not yet on Jurvio": links to noindex stub pages (rel=nofollow). */
export function CitedStubList({ stubs }: { stubs: readonly CitedStub[] }) {
  if (!stubs.length) return null;
  return <section className="contentSection caseFeatureSection citationCaseList">
    <div className="featureHeading">
      <h2>Cited cases not yet on Jurvio <span className="citationCount">{stubs.length.toLocaleString("en-US")}{stubs.length === 50 ? "+" : ""}</span></h2>
    </div>
    <p className="citationSummary">Identified from the citation; the full case record is not on Jurvio yet.</p>
    <ul>{stubs.map((stub) => <li key={stub.clusterId}>
      <Link href={stubPath(stub.clusterId) as never} rel="nofollow">{stub.caseName}</Link>
      <small> · {stub.citationLabel}{stub.dateFiled ? ` · ${stub.dateFiled.slice(0, 4)}` : ""}</small>
    </li>)}</ul>
  </section>;
}
