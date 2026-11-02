import type postgres from "postgres";
import { searchExcludedCaseSql } from "@/modules/publication/domain/search-exclusion";
import { appointingParty, percentOf, type AppealsOutcome, type AppointingParty } from "@/modules/judges/domain/lower-court-analytics";

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
  /** Colleague seats on panels this judge sat on (this judge excluded). */
  colleagueSlots: number;
  /** Of those, linked to exactly one FJC judge. */
  matchedSlots: number;
  byParty: Record<AppointingParty, number>;
}

export interface AppealsRecord {
  panelCases: number;
  authoredCases: number;
  outcomes: Record<AppealsOutcome, number>;
  outcomeSample: number;
  /** Reversed or vacated in whole, of panel cases with an affirmed/reversed/vacated/mixed outcome. */
  reversedOrVacatedPercent: number | null;
  reversalBase: number;
  firstDecided: string | null;
  lastDecided: string | null;
  panel: PanelMix;
  /** Match rates for names printed on this judge's court(s). */
  courtMatch: { slots: number; matched: number; ambiguous: number; unmatched: number } | null;
  examples: Array<{ publicId: string; caption: string; decidedOn: string | null; outcome: AppealsOutcome | null }>;
}

export interface DistrictRecord {
  /** Published district court cases whose opinion names this judge (judges line or author), linked unambiguously. */
  opinionCases: number;
  authoredCases: number;
  firstDecided: string | null;
  lastDecided: string | null;
  /** Median days from the case being filed to the case being closed, over cases where the docket shows both dates. */
  medianDaysToClose: number | null;
  closeBase: number;
  /** Match rates for names printed on district opinions of this judge's court(s). */
  courtMatch: { slots: number; matched: number; ambiguous: number; unmatched: number } | null;
  examples: Array<{ publicId: string; caption: string; decidedOn: string | null }>;
}

export interface LowerCourtProfile {
  fjcProfileUrl: string | null;
  services: FjcServiceRecord[];
  kind: "appeals" | "district" | "other";
  appeals: AppealsRecord | null;
  district: DistrictRecord | null;
}

/** Fewest closed cases for which a median time to close is shown. */
export const MIN_CLOSE_BASE = 10;

const CACHE_MS = 30 * 60_000;
const cache = new Map<string, { at: number; value: LowerCourtProfile | null }>();
const courtCache = new Map<string, { at: number; value: AppealsRecord["courtMatch"] }>();

const emptyParty = (): Record<AppointingParty, number> => ({ republican: 0, democratic: 0, other: 0, none: 0, unknown: 0 });
const emptyOutcomes = (): Record<AppealsOutcome, number> => ({ affirmed: 0, reversed: 0, vacated: 0, mixed: 0, dismissed: 0, remanded: 0, review_granted: 0, review_denied: 0 });

function isMissingRelation(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "42P01";
}

async function loadServices(tx: Sql, judgeId: string): Promise<FjcServiceRecord[]> {
  const terms = await tx<Array<Omit<FjcServiceRecord, "party" | "seniorStatusOn"> & { startedOn: string | null }>>`
    SELECT court.name AS "courtName", court.public_id AS "courtPublicId", term.court_category AS "courtCategory",
      term.service_type AS "serviceType", term.commission_date::text AS "commissionDate",
      term.started_on::text AS "startedOn", term.ended_on::text AS "endedOn",
      term.termination_reason AS "terminationReason", term.appointing_president AS "appointingPresident",
      term.appointing_president_party AS "appointingPartyRaw", term.source_url AS "sourceUrl"
    FROM judge_service_term term JOIN court ON court.id = term.court_id
    WHERE term.judge_id = ${judgeId} AND term.source_system = 'fjc'
    ORDER BY term.started_on NULLS LAST, term.service_type
  `;
  const services: FjcServiceRecord[] = [];
  for (const term of terms) {
    if (term.serviceType === "article_iii_senior") {
      const active = services.find((service) => service.courtName === term.courtName && service.serviceType !== "article_iii_senior");
      if (active) { active.seniorStatusOn = term.startedOn; active.endedOn = term.endedOn; continue; }
    }
    services.push({
      courtName: term.courtName, courtPublicId: term.courtPublicId, courtCategory: term.courtCategory,
      serviceType: term.serviceType, commissionDate: term.commissionDate, seniorStatusOn: null,
      endedOn: term.endedOn, terminationReason: term.terminationReason,
      appointingPresident: term.appointingPresident, appointingPartyRaw: term.appointingPartyRaw,
      party: appointingParty(term.appointingPartyRaw), sourceUrl: term.sourceUrl,
    });
  }
  return services;
}

async function loadAppeals(sql: Sql, judgeId: string): Promise<AppealsRecord | null> {
  try {
    return await sql.begin(async (tx) => {
      await tx`SET LOCAL statement_timeout = '3000ms'`;
      const [summary] = await tx<Array<{ panelCases: number; authoredCases: number; firstDecided: string | null; lastDecided: string | null }>>`
        SELECT count(DISTINCT s.case_id) FILTER (WHERE s.role = 'panel')::int AS "panelCases",
          count(DISTINCT s.case_id) FILTER (WHERE s.role = 'author')::int AS "authoredCases",
          min(s.decided_on)::text AS "firstDecided", max(s.decided_on)::text AS "lastDecided"
        FROM appeals_panel_seat s JOIN legal_case lc ON lc.id = s.case_id AND lc.publication = 'published'
        WHERE s.judge_id = ${judgeId}
      `;
      if (!summary || (!summary.panelCases && !summary.authoredCases)) return null;
      const outcomeRows = await tx<Array<{ outcome: AppealsOutcome; cases: number }>>`
        SELECT o.outcome, count(DISTINCT o.case_id)::int AS cases
        FROM (SELECT DISTINCT case_id FROM appeals_panel_seat WHERE judge_id = ${judgeId}) mine
        JOIN appeals_case_outcome o ON o.case_id = mine.case_id
        JOIN legal_case lc ON lc.id = o.case_id AND lc.publication = 'published'
        GROUP BY o.outcome
      `;
      const colleagueRows = await tx<Array<{ party: string | null; status: string; seats: number }>>`
        SELECT other.appointing_party AS party, other.match_status AS status, count(*)::int AS seats
        FROM (SELECT DISTINCT case_id FROM appeals_panel_seat WHERE judge_id = ${judgeId} AND role = 'panel') mine
        JOIN appeals_panel_seat other ON other.case_id = mine.case_id AND other.role = 'panel'
          AND other.judge_id IS DISTINCT FROM ${judgeId}
        GROUP BY 1, 2
      `;
      const examples = await tx<AppealsRecord["examples"]>`
        SELECT lc.public_id AS "publicId", lc.caption, s.decided_on::text AS "decidedOn", o.outcome
        FROM (SELECT DISTINCT ON (case_id) case_id, decided_on FROM appeals_panel_seat WHERE judge_id = ${judgeId}
              ORDER BY case_id) s
        JOIN legal_case lc ON lc.id = s.case_id AND lc.publication = 'published'
          AND NOT ${tx.unsafe(searchExcludedCaseSql("lc"))}
        LEFT JOIN appeals_case_outcome o ON o.case_id = s.case_id
        ORDER BY s.decided_on DESC NULLS LAST LIMIT 8
      `;
      const outcomes = emptyOutcomes();
      for (const row of outcomeRows) outcomes[row.outcome] = row.cases;
      const panel: PanelMix = { colleagueSlots: 0, matchedSlots: 0, byParty: emptyParty() };
      for (const row of colleagueRows) {
        panel.colleagueSlots += row.seats;
        if (row.status === "matched") { panel.matchedSlots += row.seats; panel.byParty[appointingParty(row.party)] += row.seats; }
      }
      const reversalBase = outcomes.affirmed + outcomes.reversed + outcomes.vacated + outcomes.mixed;
      return {
        ...summary, outcomes, outcomeSample: outcomeRows.reduce((sum, row) => sum + row.cases, 0),
        reversedOrVacatedPercent: percentOf(outcomes.reversed + outcomes.vacated, reversalBase), reversalBase,
        panel, courtMatch: null, examples,
      };
    });
  } catch (error) {
    if (!isMissingRelation(error)) console.warn("appeals record unavailable", (error as Error).message);
    return null;
  }
}

async function loadCourtMatch(sql: Sql, judgeId: string): Promise<AppealsRecord["courtMatch"]> {
  const hit = courtCache.get(judgeId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  let value: AppealsRecord["courtMatch"] = null;
  try {
    const [row] = await sql.begin(async (tx) => {
      await tx`SET LOCAL statement_timeout = '2500ms'`;
      return tx<Array<{ slots: number; matched: number; ambiguous: number; unmatched: number }>>`
        SELECT count(*)::int AS slots, count(*) FILTER (WHERE s.match_status = 'matched')::int AS matched,
          count(*) FILTER (WHERE s.match_status = 'ambiguous')::int AS ambiguous,
          count(*) FILTER (WHERE s.match_status = 'unmatched')::int AS unmatched
        FROM appeals_panel_seat s
        WHERE s.role = 'panel' AND s.court_id IN (SELECT DISTINCT court_id FROM appeals_panel_seat WHERE judge_id = ${judgeId})
      `;
    });
    value = row && row.slots ? row : null;
  } catch {
    value = null;
  }
  courtCache.set(judgeId, { at: Date.now(), value });
  return value;
}

async function loadDistrict(sql: Sql, judgeId: string): Promise<DistrictRecord | null> {
  try {
    return await sql.begin(async (tx) => {
      await tx`SET LOCAL statement_timeout = '3000ms'`;
      const [summary] = await tx<Array<{ opinionCases: number; authoredCases: number; firstDecided: string | null; lastDecided: string | null; medianDaysToClose: number | null; closeBase: number }>>`
        WITH mine AS (
          SELECT s.case_id, bool_or(s.role = 'author') AS authored, min(s.decided_on) AS decided_on
          FROM district_opinion_judge s WHERE s.judge_id = ${judgeId} GROUP BY s.case_id
        )
        SELECT count(*)::int AS "opinionCases", count(*) FILTER (WHERE mine.authored)::int AS "authoredCases",
          min(mine.decided_on)::text AS "firstDecided", max(mine.decided_on)::text AS "lastDecided",
          (percentile_cont(0.5) WITHIN GROUP (ORDER BY (lc.terminated_on - lc.filed_on))
            FILTER (WHERE lc.filed_on IS NOT NULL AND lc.terminated_on >= lc.filed_on))::int AS "medianDaysToClose",
          count(*) FILTER (WHERE lc.filed_on IS NOT NULL AND lc.terminated_on >= lc.filed_on)::int AS "closeBase"
        FROM mine JOIN legal_case lc ON lc.id = mine.case_id AND lc.publication = 'published'
      `;
      if (!summary || !summary.opinionCases) return null;
      const examples = await tx<DistrictRecord["examples"]>`
        SELECT lc.public_id AS "publicId", lc.caption, s.decided_on::text AS "decidedOn"
        FROM (SELECT DISTINCT ON (case_id) case_id, decided_on FROM district_opinion_judge WHERE judge_id = ${judgeId} ORDER BY case_id) s
        JOIN legal_case lc ON lc.id = s.case_id AND lc.publication = 'published'
          AND NOT ${tx.unsafe(searchExcludedCaseSql("lc"))}
        ORDER BY s.decided_on DESC NULLS LAST LIMIT 8
      `;
      const courtMatch = await tx<Array<{ slots: number; matched: number; ambiguous: number; unmatched: number }>>`
        SELECT count(*)::int AS slots, count(*) FILTER (WHERE s.match_status = 'matched')::int AS matched,
          count(*) FILTER (WHERE s.match_status = 'ambiguous')::int AS ambiguous,
          count(*) FILTER (WHERE s.match_status = 'unmatched')::int AS unmatched
        FROM district_opinion_judge s
        WHERE s.court_id IN (SELECT DISTINCT court_id FROM district_opinion_judge WHERE judge_id = ${judgeId})
      `;
      const match = courtMatch[0] && courtMatch[0].slots ? courtMatch[0] : null;
      const enough = summary.closeBase >= MIN_CLOSE_BASE;
      return { ...summary, medianDaysToClose: enough ? summary.medianDaysToClose : null, courtMatch: match, examples };
    });
  } catch (error) {
    if (!isMissingRelation(error)) console.warn("district record unavailable", (error as Error).message);
    return null;
  }
}

/**
 * Lower-court analytics for one public judge: the FJC appointment record and,
 * for court of appeals judges, panels, outcomes, colleagues by appointing
 * party, and match rates, from the tables the appeals backfill writes; for
 * district judges (and magistrate judges), opinions that name them and time to close.
 * Read-only, short timeouts, cached 30 minutes; null rather than throwing.
 */
export async function loadLowerCourtProfile(sql: Sql, judgePublicId: string): Promise<LowerCourtProfile | null> {
  const hit = cache.get(judgePublicId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  let value: LowerCourtProfile | null = null;
  try {
    const [judge] = await sql<Array<{ id: string; officialProfileUrl: string | null; fjcNid: string | null }>>`
      SELECT id, official_profile_url AS "officialProfileUrl", fjc_nid AS "fjcNid" FROM judge WHERE public_id = ${judgePublicId} LIMIT 1
    `;
    if (judge) {
      const services = await loadServices(sql, judge.id);
      const kind: LowerCourtProfile["kind"] = services.some((s) => s.courtCategory === "appeals") ? "appeals"
        : services.some((s) => s.courtCategory === "district") ? "district" : "other";
      const appeals = kind === "appeals" ? await loadAppeals(sql, judge.id) : null;
      if (appeals) appeals.courtMatch = await loadCourtMatch(sql, judge.id);
      const district = await loadDistrict(sql, judge.id);
      value = {
        fjcProfileUrl: judge.officialProfileUrl ?? (judge.fjcNid ? `https://www.fjc.gov/node/${encodeURIComponent(judge.fjcNid)}` : null),
        services, kind, appeals, district,
      };
    }
  } catch {
    value = null;
  }
  cache.set(judgePublicId, { at: Date.now(), value });
  return value;
}
