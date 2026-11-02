import type postgres from "postgres";
import {
  appointingParty, classifyAppellateDisposition, medianDays, parsePanelSurnames, percentOf,
  type AppellateDisposition, type AppointingParty,
} from "@/modules/judges/domain/lower-court-analytics";

type Sql = ReturnType<typeof postgres>;

export interface FjcServiceRecord {
  courtName: string;
  courtPublicId: string | null;
  courtCategory: string | null;
  serviceType: string;
  commissionDate: string | null;
  seniorStatusOn: string | null;
  endedOn: string | null;
  terminationReason: string | null;
  appointingPresident: string | null;
  appointingPartyRaw: string | null;
  party: AppointingParty;
  sourceUrl: string;
}

export interface PanelMix {
  /** Opinions by this judge whose reporter line names the panel. */
  opinionsWithPanel: number;
  /** Co-panelist name slots read from those lines (this judge excluded). */
  colleagueSlots: number;
  /** Slots matched to exactly one FJC judge serving on this court that day. */
  matchedSlots: number;
  byParty: Record<AppointingParty, number>;
}

export interface LowerCourtProfile {
  fjcProfileUrl: string | null;
  services: FjcServiceRecord[];
  kind: "appeals" | "district" | "other";
  authoredOpinions: number;
  dispositions: Record<AppellateDisposition, number>;
  dispositionSample: number;
  /** Reversed or vacated in whole, as a share of opinions with a readable outcome. */
  reversedOrVacatedPercent: number | null;
  medianDaysToDecision: number | null;
  timingSample: number;
  panel: PanelMix;
  /** Of opinions on this judge's court(s) that name an author, how many Jurvio linked to a judge identity. */
  courtAuthorMatch: { observed: number; accepted: number; needsReview: number; unmatched: number } | null;
}

const CACHE_MS = 30 * 60_000;
const cache = new Map<string, { at: number; value: LowerCourtProfile | null }>();

function surnameOf(normalizedName: string): string {
  const parts = normalizedName.toLowerCase().split(/\s+/).filter((part) => part && !/^(jr|sr|ii|iii|iv)$/.test(part));
  return (parts.at(-1) ?? "").replace(/[^a-z'-]/g, "");
}

const matchCache = new Map<string, { at: number; value: LowerCourtProfile["courtAuthorMatch"] }>();

/** How often opinion authors on these courts were linked to a judge identity (own timeout; null on timeout). */
async function courtAuthorMatch(sql: Sql, courtIds: string[]): Promise<LowerCourtProfile["courtAuthorMatch"]> {
  if (!courtIds.length) return null;
  const key = [...courtIds].sort().join(",");
  const hit = matchCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  let value: LowerCourtProfile["courtAuthorMatch"] = null;
  try {
    const [row] = await sql.begin(async (tx) => {
      await tx`SET LOCAL statement_timeout = '2000ms'`;
      return tx<Array<{ observed: number; accepted: number; needsReview: number; unmatched: number }>>`
        WITH per_opinion AS (
          SELECT case_id, source_artifact_id,
            bool_or(status = 'accepted') AS accepted, bool_or(status = 'needs_review') AS review
          FROM judge_match_candidate WHERE court_id = ANY(${courtIds}::uuid[])
          GROUP BY case_id, source_artifact_id
        )
        SELECT count(*)::int AS observed, count(*) FILTER (WHERE accepted)::int AS accepted,
          count(*) FILTER (WHERE NOT accepted AND review)::int AS "needsReview",
          count(*) FILTER (WHERE NOT accepted AND NOT review)::int AS unmatched
        FROM per_opinion
      `;
    });
    value = row && row.observed ? row : null;
  } catch {
    value = null;
  }
  matchCache.set(key, { at: Date.now(), value });
  return value;
}

const APPEALS_RE = /^ca([0-9]{1,2}|dc|fed)$/i;

function emptyParty(): Record<AppointingParty, number> {
  return { republican: 0, democratic: 0, other: 0, none: 0, unknown: 0 };
}

function emptyDisposition(): Record<AppellateDisposition, number> {
  return { affirmed: 0, reversed: 0, vacated: 0, mixed: 0, dismissed: 0, other: 0 };
}

/**
 * Lower-court analytics for one public judge: FJC appointment record, authored
 * opinion counts, outcome mix (court of appeals), time to decision, panel mix
 * by appointing president's party, and honest match rates. Read-only, under a
 * statement timeout, cached per process for 30 minutes. Returns null rather
 * than throwing so the page simply omits the section.
 */
export async function loadLowerCourtProfile(sql: Sql, judgePublicId: string): Promise<LowerCourtProfile | null> {
  const hit = cache.get(judgePublicId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  let value: LowerCourtProfile | null = null;
  try {
    value = await sql.begin(async (tx): Promise<(LowerCourtProfile & { courtIds: string[] }) | null> => {
      await tx`SET LOCAL statement_timeout = '3000ms'`;
      const [judge] = await tx<Array<{ id: string; officialProfileUrl: string | null; fjcNid: string | null }>>`
        SELECT id, official_profile_url AS "officialProfileUrl", fjc_nid AS "fjcNid" FROM judge WHERE public_id = ${judgePublicId} LIMIT 1
      `;
      if (!judge) return null;
      const terms = await tx<Array<Omit<FjcServiceRecord, "party" | "seniorStatusOn"> & { courtId: string; providerCourtId: string | null; startedOn: string | null }>>`
        SELECT court.name AS "courtName", court.public_id AS "courtPublicId", court.id AS "courtId",
          court.provider_court_id AS "providerCourtId", term.court_category AS "courtCategory",
          term.service_type AS "serviceType", term.commission_date::text AS "commissionDate",
          term.started_on::text AS "startedOn", term.ended_on::text AS "endedOn",
          term.termination_reason AS "terminationReason", term.appointing_president AS "appointingPresident",
          term.appointing_president_party AS "appointingPartyRaw", term.source_url AS "sourceUrl"
        FROM judge_service_term term JOIN court ON court.id = term.court_id
        WHERE term.judge_id = ${judge.id} AND term.source_system = 'fjc'
        ORDER BY term.started_on NULLS LAST, term.service_type
      `;
      const services: FjcServiceRecord[] = [];
      for (const term of terms) {
        if (term.serviceType === "article_iii_senior") {
          const active = services.find((service) => service.courtName === term.courtName && service.serviceType !== "article_iii_senior");
          if (active) { active.seniorStatusOn = term.startedOn; continue; }
        }
        services.push({
          courtName: term.courtName, courtPublicId: term.courtPublicId, courtCategory: term.courtCategory,
          serviceType: term.serviceType, commissionDate: term.commissionDate, seniorStatusOn: null,
          endedOn: term.endedOn, terminationReason: term.terminationReason,
          appointingPresident: term.appointingPresident, appointingPartyRaw: term.appointingPartyRaw,
          party: appointingParty(term.appointingPartyRaw), sourceUrl: term.sourceUrl,
        });
      }

      const opinions = await tx<Array<{ caseId: string; courtId: string; providerCourtId: string | null; filedOn: string | null; decidedOn: string | null; panel: string | null; disposition: string | null }>>`
        SELECT DISTINCT ON (lc.id) lc.id AS "caseId", lc.court_id AS "courtId", court.provider_court_id AS "providerCourtId",
          lc.filed_on::text AS "filedOn", COALESCE(oc.date_filed, lc.decided_on)::text AS "decidedOn",
          oc.judges AS panel, NULLIF(btrim(oc.provider_metadata->>'disposition'), '') AS disposition
        FROM judge_case_assignment a
        JOIN legal_case lc ON lc.id = a.case_id AND lc.publication = 'published'
        JOIN court ON court.id = lc.court_id
        LEFT JOIN opinion_cluster oc ON oc.case_id = lc.id
        WHERE a.judge_id = ${judge.id} AND a.assignment_role = 'opinion_author'
        ORDER BY lc.id, oc.date_filed DESC NULLS LAST
        LIMIT 20000
      `;
      const appealsCount = opinions.filter((row) => APPEALS_RE.test(row.providerCourtId ?? "")).length;
      const kind: LowerCourtProfile["kind"] = appealsCount > opinions.length / 2 || services.some((s) => s.courtCategory === "appeals")
        ? "appeals" : services.some((s) => s.courtCategory === "district") ? "district" : "other";

      const dispositions = emptyDisposition();
      let dispositionSample = 0;
      const timings: number[] = [];
      for (const row of opinions) {
        if (row.disposition) {
          const outcome = classifyAppellateDisposition(row.disposition);
          dispositions[outcome] += 1;
          if (outcome !== "other") dispositionSample += 1;
        }
        if (row.filedOn && row.decidedOn) {
          const days = Math.round((Date.parse(row.decidedOn) - Date.parse(row.filedOn)) / 86_400_000);
          if (days >= 0 && days < 365 * 15) timings.push(days);
        }
      }
      const readable = dispositionSample - dispositions.dismissed;

      // Panel mix: match reporter surnames to FJC judges serving on the same court that day.
      const courtIds = [...new Set(opinions.map((row) => row.courtId))];
      const rosterRows = courtIds.length ? await tx<Array<{ judgeId: string; courtId: string; normalizedName: string; startedOn: string | null; endedOn: string | null; party: string | null }>>`
        SELECT term.judge_id AS "judgeId", term.court_id AS "courtId", j.normalized_name AS "normalizedName",
          term.started_on::text AS "startedOn", term.ended_on::text AS "endedOn",
          term.appointing_president_party AS party
        FROM judge_service_term term JOIN judge j ON j.id = term.judge_id
        WHERE term.court_id = ANY(${courtIds}::uuid[]) AND term.source_system = 'fjc'
      ` : [];
      const roster = rosterRows.map((row) => ({ ...row, surname: surnameOf(row.normalizedName) }));
      const ownSurnames = new Set(roster.filter((row) => row.judgeId === judge.id).map((row) => row.surname));
      const panel: PanelMix = { opinionsWithPanel: 0, colleagueSlots: 0, matchedSlots: 0, byParty: emptyParty() };
      for (const row of opinions) {
        const names = parsePanelSurnames(row.panel).filter((name) => !ownSurnames.has(name));
        if (!row.panel || !parsePanelSurnames(row.panel).length) continue;
        panel.opinionsWithPanel += 1;
        for (const name of names) {
          panel.colleagueSlots += 1;
          const day = row.decidedOn;
          const matches = new Map<string, string | null>();
          for (const member of roster) {
            if (member.courtId !== row.courtId || member.surname !== name || member.judgeId === judge.id) continue;
            if (day && member.startedOn && member.startedOn > day) continue;
            if (day && member.endedOn && member.endedOn < day) continue;
            matches.set(member.judgeId, member.party);
          }
          if (matches.size === 1) {
            panel.matchedSlots += 1;
            panel.byParty[appointingParty([...matches.values()][0])] += 1;
          }
        }
      }


      return {
        fjcProfileUrl: judge.officialProfileUrl ?? (judge.fjcNid ? `https://www.fjc.gov/node/${encodeURIComponent(judge.fjcNid)}` : null),
        services, kind, authoredOpinions: opinions.length, dispositions, dispositionSample,
        reversedOrVacatedPercent: percentOf(dispositions.reversed + dispositions.vacated, readable),
        medianDaysToDecision: medianDays(timings), timingSample: timings.length,
        panel, courtAuthorMatch: null, courtIds,
      };
    });
    if (value) {
      const { courtIds, ...rest } = value as LowerCourtProfile & { courtIds: string[] };
      value = { ...rest, courtAuthorMatch: await courtAuthorMatch(sql, courtIds) };
    }
  } catch {
    value = null;
  }
  cache.set(judgePublicId, { at: Date.now(), value });
  return value;
}
