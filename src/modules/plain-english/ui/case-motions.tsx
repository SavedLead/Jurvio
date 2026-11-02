import Link from "next/link";
import type { Route } from "next";
import { STATUS_PLAIN, type PlainMotion } from "@/modules/plain-english/domain/motion-guide";
import { formatPublicCaseDate } from "@/modules/cases/domain/scotus-display";

const STATUS_TONE: Record<PlainMotion["status"], string> = {
  granted: "#1f7a4a", denied: "#b4403a", partly: "#8a5a00", moot: "#5e687e", "no-ruling-shown": "#5e687e",
};

/** Every readable motion on the trial court docket, in plain English, with the docket's own words. */
export function CaseMotionsSection({ motions, caseId, scanned }: { motions: PlainMotion[]; caseId: string; scanned: number }) {
  if (!motions.length) return null;
  const decided = motions.filter((motion) => motion.status !== "no-ruling-shown").length;
  const docketPath = `/case/${caseId}/docket`;
  return <section className="contentSection caseFeatureSection" aria-labelledby="motions-plain" id="motions">
    <div className="featureHeading">
      <div><p className="sectionKicker">Motions, in plain English</p><h2 id="motions-plain">What the parties asked the judge to do</h2></div>
      <strong className="decisionLabel">{motions.length} {motions.length === 1 ? "request" : "requests"} · {decided} decided</strong>
    </div>
    <p style={{ color: "#4b556b", lineHeight: 1.6 }}>A <em>motion</em> is a formal request asking the judge to do something, such as end the case early or give more time. Below is each motion Jurvio could read on the public docket, what it asks for in plain words, and the judge’s ruling when the docket shows one.</p>
    <ol style={{ listStyle: "none", padding: 0, margin: "16px 0 0", display: "grid", gap: 12 }}>
      {motions.map((motion) => <li key={`${motion.entryNumber}:${motion.entryPublicId}:${motion.kind.key}`}
        style={{ padding: "14px 16px", border: "1px solid #dce1eb", borderRadius: 12, background: "#fff", lineHeight: 1.55 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", alignItems: "baseline" }}>
          <strong>Motion: {motion.kind.label}</strong>
          <span style={{ color: "#6a7489", fontSize: ".88rem" }}>{motion.filedOn ? formatPublicCaseDate(motion.filedOn) ?? motion.filedOn : "Date not shown"}{motion.entryNumber ? ` · Docket entry ${motion.entryNumber}` : ""}{motion.by ? ` · Filed by ${motion.by}` : ""}</span>
        </div>
        <p style={{ margin: "6px 0" }}>{motion.kind.plain}</p>
        <p style={{ margin: "6px 0", color: STATUS_TONE[motion.status], fontWeight: 600 }}>{STATUS_PLAIN[motion.status]}{motion.rulingOn ? ` (${formatPublicCaseDate(motion.rulingOn) ?? motion.rulingOn}${motion.rulingEntryNumber ? `, entry ${motion.rulingEntryNumber}` : ""})` : ""}</p>
        <details>
          <summary style={{ cursor: "pointer", color: "#2f45c5", fontSize: ".9rem" }}>The docket’s own words</summary>
          <blockquote style={{ margin: "8px 0 0", padding: "8px 12px", borderLeft: "3px solid #dce1eb", color: "#4b556b", fontSize: ".9rem" }}>
            <small>Request:</small> “{motion.text}”
            {motion.rulingText ? <><br /><small>Ruling:</small> “{motion.rulingText}”</> : null}
            {motion.rulingMatchedBy === "only-matching-order" ? <><br /><small>This order does not cite the motion’s number; it is linked because it is the only order of this type and this is the only such motion.</small></> : null}
            <br /><Link href={(motion.entryPublicId ? `${docketPath}#entry-${motion.entryPublicId}` : docketPath) as Route}>Open the docket →</Link>
          </blockquote>
        </details>
      </li>)}
    </ol>
    <p style={{ color: "#6a7489", fontSize: ".85rem", marginTop: 12 }}>Read from the {scanned.toLocaleString()} most recent docket entries Jurvio holds, by fixed rules (no AI). A ruling is linked when an order cites the motion’s docket number, or when it is the only order of that type and the motion is the only one of its type. Otherwise “No ruling appears” can also mean an order did not say which motion it decided. Sealed and private entries are never read or shown. This is not legal advice.</p>
  </section>;
}
