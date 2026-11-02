import Link from "next/link";
import { cleanCaseCaption } from "@/modules/cases/ui/branded-case-caption";
import type { Route } from "next";
import type { AppealsRecord, DistrictRecord, LowerCourtProfile } from "@/modules/judges/application/lower-court-profile";
import { appointmentPhrase, FJC_BIOGRAPHICAL_DIRECTORY_URL, percentOf, type AppealsOutcome } from "@/modules/judges/domain/lower-court-analytics";
import directory from "@/modules/directory/ui/directory.module.css";
import styles from "@/modules/judges/ui/judge-analytics.module.css";

/** Below this many appeals with a readable result, a percentage would mislead. */
const MIN_REVERSAL_BASE = 10;

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

const plural = (count: number, one: string, many: string) => `${count.toLocaleString()} ${count === 1 ? one : many}`;
const pct = (value: number | null) => (value === null ? "Not enough data" : `${value}%`);

const OUTCOME_WORD: Record<AppealsOutcome, string> = {
  affirmed: "Affirmed", reversed: "Reversed", vacated: "Vacated", mixed: "Partly affirmed, partly set aside", dismissed: "Appeal dismissed",
  remanded: "Sent back (remanded)", review_granted: "Agency petition granted", review_denied: "Agency petition denied",
};

function AppealsSection({ record, judgeName }: { record: AppealsRecord; judgeName: string }) {
  const { panel } = record;
  const partySlots = panel.byParty.republican + panel.byParty.democratic + panel.byParty.other + panel.byParty.none;
  const share = (count: number) => percentOf(count, partySlots) ?? 0;
  const match = record.courtMatch;
  const known = (Object.keys(record.outcomes) as AppealsOutcome[]).filter((key) => record.outcomes[key] > 0);
  return <section className={directory.section} id="appeals-record" data-judge-record="appeals">
    <h2>Record as a court of appeals judge</h2>
    <p className={styles.small}>A court of appeals reviews decisions of district courts and federal agencies. Three judges (a <em>panel</em>) usually decide each appeal, and one writes the opinion. These counts use only opinions on Jurvio that name {judgeName} in the printed list of judges or as the author{record.firstDecided && record.lastDecided ? `, decided ${formatDate(record.firstDecided)} to ${formatDate(record.lastDecided)}` : ""}.</p>
    <div className={styles.grid}>
      <div className={styles.stat}><span>Appeals on a panel (on Jurvio)</span><strong>{record.panelCases.toLocaleString()}</strong><span>{plural(record.authoredCases, "opinion", "opinions")} written by this judge</span></div>
      <div className={styles.stat}><span>Panel reversed or vacated the decision below</span><strong>{record.reversalBase >= MIN_REVERSAL_BASE ? pct(record.reversedOrVacatedPercent) : "Too few to say"}</strong><span>{record.reversalBase >= MIN_REVERSAL_BASE ? <>of {plural(record.reversalBase, "appeal", "appeals")} with a readable result</> : <>only {plural(record.reversalBase, "appeal", "appeals")} with a readable result; a percentage needs at least {MIN_REVERSAL_BASE}</>}</span></div>
      <div className={styles.stat}><span>Time from appeal filed to decision</span><strong style={{ fontSize: "1.05rem" }}>Not shown</strong><span>The records Jurvio holds rarely include the date an appeal was filed, so a median would not be reliable.</span></div>
    </div>
    {known.length ? <ul className={styles.legend} style={{ listStyle: "none", padding: 0, marginTop: 14 }}>{known.map((key) => <li key={key}>{OUTCOME_WORD[key]}: <strong>{record.outcomes[key].toLocaleString()}</strong></li>)}</ul> : null}
    <p className={styles.small} style={{ marginTop: 14 }}><strong>Reading this:</strong> <em>affirmed</em> means the lower court’s decision stands; <em>reversed</em> means the appeals court overturned it; <em>vacated</em> means it was set aside, usually for the lower court to decide again. The percentage counts only whole reversals or vacaturs, out of appeals that were affirmed, reversed, vacated, or partly each; dismissed appeals and agency petitions are left out. Results are read by fixed word rules from the outcome line printed with the opinion or the court’s own closing words (for example “AFFIRMED.”); {plural(record.panelCases - record.outcomeSample, "appeal has", "appeals have")} no readable result and {record.panelCases - record.outcomeSample === 1 ? "is" : "are"} not counted. A reversal is the panel’s decision, not a grade of this judge.</p>

    <h3 style={{ marginTop: 24 }}>Who sat with this judge</h3>
    {panel.matchedSlots ? <>
      <div className={styles.mix} role="img" aria-label={`Colleagues on panels: ${share(panel.byParty.republican)}% appointed by Republican presidents, ${share(panel.byParty.democratic)}% by Democratic presidents`}>
        <div className={styles.mixR} style={{ width: `${share(panel.byParty.republican)}%` }} />
        <div className={styles.mixD} style={{ width: `${share(panel.byParty.democratic)}%` }} />
        <div className={styles.mixO} style={{ width: `${share(panel.byParty.other + panel.byParty.none)}%` }} />
      </div>
      <div className={styles.legend}>
        <span><i className={`${styles.swatch} ${styles.mixR}`} />Appointed by a Republican president: {panel.byParty.republican.toLocaleString()} ({share(panel.byParty.republican)}%)</span>
        <span><i className={`${styles.swatch} ${styles.mixD}`} />Appointed by a Democratic president: {panel.byParty.democratic.toLocaleString()} ({share(panel.byParty.democratic)}%)</span>
        {panel.byParty.other + panel.byParty.none ? <span><i className={`${styles.swatch} ${styles.mixO}`} />Other or none recorded: {(panel.byParty.other + panel.byParty.none).toLocaleString()}</span> : null}
      </div>
    </> : <p>The records Jurvio holds do not name enough panel colleagues to show this.</p>}
    <p className={styles.small}>Each colleague seat counts once per appeal. Party means the party of the president who appointed that colleague, from the FJC record. Names are linked to the FJC record only when exactly one judge with that surname served on this court on the decision date; visiting judges from district courts or other circuits are usually not linked.</p>

    <h3 style={{ marginTop: 24 }}>How complete this is</h3>
    <ul className={styles.small} style={{ lineHeight: 1.7 }}>
      <li>{panel.matchedSlots.toLocaleString()} of {panel.colleagueSlots.toLocaleString()} colleague names on this judge’s panels were linked ({pct(percentOf(panel.matchedSlots, panel.colleagueSlots))}).</li>
      {match ? <li>Across this court, {match.matched.toLocaleString()} of {match.slots.toLocaleString()} printed panel names were linked to one judge ({pct(percentOf(match.matched, match.slots))}); {plural(match.ambiguous, "was", "were")} shared by more than one judge serving then and {plural(match.unmatched, "had", "had")} no FJC match. Those are left out rather than guessed.</li> : null}
      <li>Opinions without a printed list of judges are not counted at all, so these numbers cover only part of this judge’s work.</li>
    </ul>
    {record.examples.length ? <><h3 style={{ marginTop: 24 }}>Recent appeals</h3>
      <ol className={directory.caseList}>{record.examples.map((item) => <li key={item.publicId}>
        <Link href={`/case/${item.publicId}` as Route}><div><h3>{cleanCaseCaption(item.caption)}</h3><p>{item.outcome ? OUTCOME_WORD[item.outcome] : "No readable result"}</p></div><time>{item.decidedOn ?? "Date unavailable"}</time></Link>
      </li>)}</ol></> : null}
  </section>;
}

function durationPhrase(days: number): string {
  if (days < 60) return plural(days, "day", "days");
  const months = Math.round(days / 30.44);
  if (months < 24) return plural(months, "month", "months");
  return `${(days / 365.25).toFixed(1)} years`;
}

function DistrictSection({ record, judgeName }: { record: DistrictRecord; judgeName: string }) {
  const match = record.courtMatch;
  return <section className={directory.section} id="district-record" data-judge-record="district">
    <h2>Record as a district court judge</h2>
    <p className={styles.small}>A district court is the federal trial court: it hears the case first, decides motions, and holds any trial. One judge is assigned to each case. These counts use only published district court opinions on Jurvio that name {judgeName} as the judge or the opinion’s author{record.firstDecided && record.lastDecided ? `, dated ${formatDate(record.firstDecided)} to ${formatDate(record.lastDecided)}` : ""}.</p>
    <div className={styles.grid}>
      <div className={styles.stat}><span>District court opinions (on Jurvio)</span><strong>{record.opinionCases.toLocaleString()}</strong><span>{record.authoredCases.toLocaleString()} of these {record.authoredCases === 1 ? "names" : "name"} this judge as the opinion’s author</span></div>
      <div className={styles.stat}><span>Typical time from case filed to case closed</span><strong style={record.medianDaysToClose === null ? { fontSize: "1.05rem" } : undefined}>{record.medianDaysToClose === null ? "Too few to say" : durationPhrase(record.medianDaysToClose)}</strong><span>{record.medianDaysToClose === null
        ? `only ${plural(record.closeBase, "of these cases shows", "of these cases show")} both a filing date and a closing date; a typical time needs at least 10`
        : `median of ${plural(record.closeBase, "case", "cases")} whose docket shows both a filing date and a closing date`}</span></div>
      <div className={styles.stat}><span>How often this judge is reversed on appeal</span><strong style={{ fontSize: "1.05rem" }}>Not shown</strong><span>The records Jurvio holds do not reliably connect a district court case to its appeal, so a reversal rate cannot be computed.</span></div>
    </div>
    <p className={styles.small} style={{ marginTop: 14 }}><strong>Reading this:</strong> the <em>median</em> is the middle value: half of these cases closed faster and half slower. A case is <em>closed</em> (terminated) when the court enters its final action, which can be a judgment, a dismissal, or a settlement; the closing judge may not be the judge who wrote the opinion. Judge names are linked to the Federal Judicial Center record only when exactly one district judge or magistrate judge with that surname served on this court on the opinion date.</p>

    <h3 style={{ marginTop: 24 }}>How complete this is</h3>
    <ul className={styles.small} style={{ lineHeight: 1.7 }}>
      {match ? <li>Across this court, {match.matched.toLocaleString()} of {match.slots.toLocaleString()} judge names printed on district opinions were linked to one judge ({pct(percentOf(match.matched, match.slots))}); {plural(match.ambiguous, "was", "were")} shared by more than one judge serving then and {plural(match.unmatched, "had", "had")} no FJC match. Those are left out rather than guessed.</li> : null}
      <li>Most district court rulings are short orders that are never published as opinions, so these numbers cover only a small part of this judge’s work.</li>
    </ul>
    {record.examples.length ? <><h3 style={{ marginTop: 24 }}>Recent opinions</h3>
      <ol className={directory.caseList}>{record.examples.map((item) => <li key={item.publicId}>
        <Link href={`/case/${item.publicId}` as Route}><div><h3>{cleanCaseCaption(item.caption)}</h3><p>District court opinion</p></div><time>{item.decidedOn ?? "Date unavailable"}</time></Link>
      </li>)}</ol></> : null}
  </section>;
}

/** FJC appointment record plus court of appeals analytics. Facts only, each with its source. */
export function LowerCourtRecordSection({ profile, judgeName }: { profile: LowerCourtProfile; judgeName: string }) {
  const fjcLink = profile.fjcProfileUrl ?? FJC_BIOGRAPHICAL_DIRECTORY_URL;
  return <>
    <section className={directory.section} id="appointment-record" data-judge-record="fjc">
      <h2>Appointment record</h2>
      <p className={styles.small}>From the Federal Judicial Center’s Biographical Directory of Article III Federal Judges, the federal courts’ official history office. A <em>commission date</em> is the day the judge formally took office after Senate confirmation. <em>Senior status</em> is a form of semi-retirement: the judge keeps hearing cases, usually fewer, and the seat opens for a new appointment.</p>
      {profile.services.length ? <ul className={styles.record}>{profile.services.map((service) => <li key={`${service.courtName}:${service.commissionDate}:${service.serviceType}`}>
        <h3>{service.courtPublicId ? <Link className={styles.link} href={`/courts/${service.courtPublicId}` as Route}>{service.courtName}</Link> : service.courtName}</h3>
        <dl>
          <dt>Appointment</dt><dd>{appointmentPhrase(service.appointingPresident, service.appointingPartyRaw)}</dd>
          <dt>Commissioned</dt><dd>{formatDate(service.commissionDate) ?? "Not shown in the FJC record"}</dd>
          <dt>Senior status</dt><dd>{formatDate(service.seniorStatusOn) ?? "None recorded"}</dd>
          {service.endedOn && !service.seniorStatusOn ? <><dt>Service ended</dt><dd>{formatDate(service.endedOn)}{service.terminationReason ? ` (${service.terminationReason})` : ""}</dd></> : null}
        </dl>
      </li>)}</ul> : <p>Jurvio has not linked {judgeName} to a Federal Judicial Center record, so appointment details are not shown. Many magistrate and bankruptcy judges are not in that directory because they are not appointed by the President.</p>}
      <p className={styles.small}>Source: <a className={styles.link} href={fjcLink} rel="noopener">FJC Biographical Directory{profile.fjcProfileUrl ? ` entry for ${judgeName}` : ""} →</a>. “Republican” or “Democratic” here describes only the party of the president who made the appointment. It is not a rating of the judge’s views.</p>
    </section>

    {profile.kind === "appeals" ? (profile.appeals ? <AppealsSection record={profile.appeals} judgeName={judgeName} />
      : <section className={directory.section} id="appeals-record" data-judge-record="appeals-empty"><h2>Record as a court of appeals judge</h2><p>Jurvio has not yet linked this judge to any court of appeals opinion it holds. Opinions are linked only when the printed list of judges names this judge unambiguously.</p></section>) : null}
    {profile.district ? <DistrictSection record={profile.district} judgeName={judgeName} />
      : profile.kind === "district" ? <section className={directory.section} id="district-record" data-judge-record="district-empty"><h2>Record as a district court judge</h2><p>Jurvio has not yet linked this judge to any published district court opinion it holds. Opinions are linked only when the printed judge name matches this judge unambiguously.</p></section> : null}
  </>;
}
