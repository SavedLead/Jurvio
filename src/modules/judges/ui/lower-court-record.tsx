import Link from "next/link";
import type { Route } from "next";
import type { LowerCourtProfile } from "@/modules/judges/application/lower-court-profile";
import { appointmentPhrase, FJC_BIOGRAPHICAL_DIRECTORY_URL, percentOf, plainDuration } from "@/modules/judges/domain/lower-court-analytics";
import directory from "@/modules/directory/ui/directory.module.css";
import styles from "@/modules/judges/ui/judge-analytics.module.css";

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

const plural = (count: number, one: string, many: string) => `${count.toLocaleString()} ${count === 1 ? one : many}`;
const pct = (value: number | null) => (value === null ? "Not enough data" : `${value}%`);

/** FJC appointment record plus appeals/district analytics. Facts only, each with its source. */
export function LowerCourtRecordSection({ profile, judgeName }: { profile: LowerCourtProfile; judgeName: string }) {
  const fjcLink = profile.fjcProfileUrl ?? FJC_BIOGRAPHICAL_DIRECTORY_URL;
  const { panel } = profile;
  const partySlots = panel.byParty.republican + panel.byParty.democratic + panel.byParty.other + panel.byParty.none;
  const share = (count: number) => percentOf(count, partySlots) ?? 0;
  const match = profile.courtAuthorMatch;
  const outcomeKnown = profile.dispositionSample - profile.dispositions.dismissed;

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

    {profile.kind === "appeals" ? <section className={directory.section} id="appeals-record" data-judge-record="appeals">
      <h2>Record as a court of appeals judge</h2>
      <p className={styles.small}>Counts use only opinions on Jurvio that name {judgeName} as the author. A court of appeals hears appeals from district courts; three judges (a <em>panel</em>) usually decide each case, and one writes the opinion.</p>
      <div className={styles.grid}>
        <div className={styles.stat}><span>Opinions written (on Jurvio)</span><strong>{profile.authoredOpinions.toLocaleString()}</strong></div>
        <div className={styles.stat}><span>Reversed or vacated the decision below</span><strong>{pct(profile.reversedOrVacatedPercent)}</strong><span>{outcomeKnown.toLocaleString()} opinions with a readable outcome</span></div>
        <div className={styles.stat}><span>Median time, appeal filed to decision</span><strong>{plainDuration(profile.medianDaysToDecision)}</strong><span>{profile.timingSample.toLocaleString()} appeals with both dates</span></div>
      </div>
      <p className={styles.small} style={{ marginTop: 14 }}><strong>Reading this:</strong> <em>affirmed</em> means the lower court’s decision stands; <em>reversed</em> means it was overturned; <em>vacated</em> means it was set aside, usually for the lower court to decide again. Partial results (“affirmed in part, reversed in part”, {profile.dispositions.mixed.toLocaleString()} here) count as a readable outcome but not as a reversal. Dismissed appeals ({profile.dispositions.dismissed.toLocaleString()}) are left out of the percentage. Outcomes come from the outcome line the court’s reporter records with each opinion, sorted by fixed word rules; {plural(profile.authoredOpinions - profile.dispositionSample, "opinion has", "opinions have")} no readable outcome line and {profile.authoredOpinions - profile.dispositionSample === 1 ? "is" : "are"} left out.</p>

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
      <p className={styles.small}>Each colleague seat on a panel counts once. Names come from the judges line printed with each opinion and are matched to the FJC record only when exactly one judge with that surname served on this court on that date. Visiting district judges and judges from other circuits are usually not matched.</p>

      <h3 style={{ marginTop: 24 }}>How complete this is</h3>
      <ul className={styles.small} style={{ lineHeight: 1.7 }}>
        <li>Panel names read from {panel.opinionsWithPanel.toLocaleString()} of {profile.authoredOpinions.toLocaleString()} opinions; {panel.matchedSlots.toLocaleString()} of {panel.colleagueSlots.toLocaleString()} colleague names matched ({pct(percentOf(panel.matchedSlots, panel.colleagueSlots))}).</li>
        {match ? <li>On this court, Jurvio linked {match.accepted.toLocaleString()} of {match.observed.toLocaleString()} named opinion authors to a judge ({pct(percentOf(match.accepted, match.observed))}); {plural(match.needsReview, "was", "were")} too close to call and {plural(match.unmatched, "had", "had")} no eligible judge; those are left out rather than guessed.</li> : <li>The author match rate for this court is not available right now.</li>}
      </ul>
    </section> : null}
  </>;
}
