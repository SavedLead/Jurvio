import type postgres from "postgres";
import { importFjcJudges } from "./import-fjc-judges";
import { importBrmagJudges } from "./import-brmag-judges";
import { matchJudgesToCases } from "./match-judges";
import { recordRepairAction } from "@/modules/ingestion/application/pg-job-queue";

type Sql = ReturnType<typeof postgres>;

export interface JudgeAutopilotSnapshot {
  roster: number;
  active: number;
  services: number;
  assignments: number;
  published: number;
  pendingMatches: number;
  reviewMatches: number;
  latestRosterAt: string | null;
}

export interface JudgeAutopilotAssessment {
  rosterMissing: boolean;
  rosterStale: boolean;
  publicationBehind: boolean;
  matchingBehind: boolean;
}

const MINIMUM_FJC_ROSTER = 1_000;
const ROSTER_STALE_HOURS = 36;

export function assessJudgeAutopilot(
  snapshot: JudgeAutopilotSnapshot,
  now = new Date(),
): JudgeAutopilotAssessment {
  const latest = snapshot.latestRosterAt ? new Date(snapshot.latestRosterAt).getTime() : 0;
  return {
    rosterMissing: snapshot.roster < MINIMUM_FJC_ROSTER || snapshot.services === 0,
    rosterStale: !latest || now.getTime() - latest > ROSTER_STALE_HOURS * 60 * 60 * 1_000,
    publicationBehind: snapshot.published < snapshot.roster,
    matchingBehind: snapshot.pendingMatches > 0,
  };
}

export async function getJudgeAutopilotSnapshot(sql: Sql): Promise<JudgeAutopilotSnapshot> {
  const [row] = await sql<Array<{
    roster: string; active: string; services: string; assignments: string; published: string;
    pendingMatches: string; reviewMatches: string; latestRosterAt: string | null;
  }>>`
    SELECT
      (SELECT count(*) FROM judge WHERE (fjc_nid IS NOT NULL OR brmag_id IS NOT NULL) AND verification = 'verified')::text AS roster,
      (SELECT count(*) FROM judge WHERE (fjc_nid IS NOT NULL OR brmag_id IS NOT NULL) AND active = true)::text AS active,
      (SELECT count(*) FROM judge_service_term WHERE source_system IN ('fjc', 'brmag') AND verification = 'verified')::text AS services,
      (SELECT count(*) FROM judge_case_assignment)::text AS assignments,
      (SELECT count(*) FROM judge j WHERE (j.fjc_nid IS NOT NULL OR j.brmag_id IS NOT NULL) AND EXISTS (
        SELECT 1 FROM publication_decision pd WHERE pd.object_type = 'judge' AND pd.object_id = j.id
          AND pd.displayable = true
      ))::text AS published,
      (SELECT count(*) FROM judicial_opinion jo
        JOIN document d ON d.id = jo.document_id
        WHERE jo.author_name IS NOT NULL AND btrim(jo.author_name) <> '' AND jo.per_curiam = false
          AND NOT EXISTS (SELECT 1 FROM judge_match_candidate jmc
            WHERE jmc.case_id = d.case_id AND jmc.source_artifact_id = jo.source_artifact_id
              AND jmc.matcher_version = 'jurisdiction-timeframe-v2'))::text AS "pendingMatches",
      (SELECT count(*) FROM judge_match_candidate
        WHERE matcher_version = 'jurisdiction-timeframe-v2' AND status = 'needs_review')::text AS "reviewMatches",
      (SELECT max(ra.retrieved_at)::text FROM raw_artifact ra
        JOIN provider p ON p.id = ra.provider_id WHERE p.code = 'fjc') AS "latestRosterAt"
  `;
  return {
    roster: Number(row?.roster ?? 0), active: Number(row?.active ?? 0),
    services: Number(row?.services ?? 0), assignments: Number(row?.assignments ?? 0),
    published: Number(row?.published ?? 0), pendingMatches: Number(row?.pendingMatches ?? 0),
    reviewMatches: Number(row?.reviewMatches ?? 0), latestRosterAt: row?.latestRosterAt ?? null,
  };
}

async function audit(
  sql: Sql, action: string, reason: string, outcome: string, detail: Record<string, unknown>,
) {
  await recordRepairAction(sql, {
    detector: "judge-autopilot", subject: "federal_judges", action, reason, outcome, detail,
  });
}

async function publishVerifiedRoster(sql: Sql): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    INSERT INTO publication_decision (
      object_type, object_id, displayable, indexable, machine_accessible, downloadable,
      summary_eligible, reason_code, rule_version
    )
    SELECT 'judge', judge.id, true, true, true, false, false,
      CASE WHEN judge.fjc_nid IS NOT NULL THEN 'verified_fjc_identity' ELSE 'verified_brmag_identity' END,
      'judge-publication-v3'
    FROM judge
    WHERE (judge.fjc_nid IS NOT NULL OR judge.brmag_id IS NOT NULL) AND judge.verification = 'verified'
      AND NOT EXISTS (
        SELECT 1 FROM publication_decision decision
        WHERE decision.object_type = 'judge' AND decision.object_id = judge.id
      )
    RETURNING object_id AS id
  `;
  return rows.length;
}

async function verifyPublicPages(sql: Sql): Promise<{ directory: boolean; profile: boolean; detail: string }> {
  const origin = (process.env.SITE_URL ?? "https://jurvio.com").replace(/\/$/, "");
  const [sample] = await sql<{ publicId: string }[]>`
    SELECT public_id AS "publicId" FROM judge
    WHERE fjc_nid IS NOT NULL AND verification = 'verified'
      AND EXISTS (SELECT 1 FROM publication_decision pd
        WHERE pd.object_type = 'judge' AND pd.object_id = judge.id AND pd.displayable = true)
    ORDER BY active DESC NULLS LAST, display_name LIMIT 1
  `;
  try {
    const directoryResponse = await fetch(`${origin}/judges`, {
      signal: AbortSignal.timeout(15_000), headers: { "user-agent": "Jurvio Judge Autopilot/1.0" },
    });
    const directoryBody = await directoryResponse.text();
    const directory = directoryResponse.ok && !directoryBody.includes("No verified judge profiles");
    if (!sample) return { directory, profile: false, detail: "no published sample judge" };
    const profileResponse = await fetch(`${origin}/judges/${sample.publicId}`, {
      signal: AbortSignal.timeout(15_000), headers: { "user-agent": "Jurvio Judge Autopilot/1.0" },
    });
    return {
      directory, profile: profileResponse.ok,
      detail: `directory=${directoryResponse.status} profile=${profileResponse.status}`,
    };
  } catch (error) {
    return { directory: false, profile: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

export async function runJudgeAutopilot(sql: Sql): Promise<JudgeAutopilotSnapshot> {
  const [lock] = await sql<{ locked: boolean }[]>`SELECT pg_try_advisory_lock(71483621) AS locked`;
  if (!lock?.locked) return getJudgeAutopilotSnapshot(sql);
  try {
    let snapshot = await getJudgeAutopilotSnapshot(sql);
    let assessment = assessJudgeAutopilot(snapshot);

    if (assessment.rosterMissing || assessment.rosterStale) {
      try {
        const result = await importFjcJudges(sql, { limit: 50_000 });
        await audit(sql, "refresh_fjc_roster",
          assessment.rosterMissing ? "authoritative roster incomplete" : "authoritative roster stale",
          "repaired", result);
      } catch (error) {
        await audit(sql, "refresh_fjc_roster", "authoritative roster unavailable", "failed",
          { error: error instanceof Error ? error.message : String(error) });
      }
      snapshot = await getJudgeAutopilotSnapshot(sql);
      assessment = assessJudgeAutopilot(snapshot);
    }

    // Article I bench (magistrate + bankruptcy) from the BR/MAG source. Governed
    // independently of the FJC Article III roster — its own provider provenance
    // and staleness window — then the shared publication step below publishes any
    // newly imported Article I judges.
    const [brmag] = await sql<{ count: string; latest: string | null }[]>`
      SELECT (SELECT count(*) FROM judge WHERE brmag_id IS NOT NULL)::text AS count,
        (SELECT max(ra.retrieved_at)::text FROM raw_artifact ra
          JOIN provider p ON p.id = ra.provider_id WHERE p.code = 'brmag') AS latest
    `;
    const brmagCount = Number(brmag?.count ?? 0);
    const brmagLatest = brmag?.latest ? new Date(brmag.latest).getTime() : 0;
    const brmagStale = !brmagLatest || Date.now() - brmagLatest > ROSTER_STALE_HOURS * 60 * 60 * 1_000;
    if (brmagCount < 1 || brmagStale) {
      try {
        const result = await importBrmagJudges(sql, { limit: 50_000 });
        await audit(sql, "refresh_brmag_roster",
          brmagCount < 1 ? "article I bench missing" : "article I bench stale", "repaired", result);
      } catch (error) {
        await audit(sql, "refresh_brmag_roster", "article I bench source unavailable", "failed",
          { error: error instanceof Error ? error.message : String(error) });
      }
      snapshot = await getJudgeAutopilotSnapshot(sql);
      assessment = assessJudgeAutopilot(snapshot);
    }

    if (assessment.publicationBehind) {
      try {
        const published = await publishVerifiedRoster(sql);
        await audit(sql, "repair_judge_publication",
          `${snapshot.roster - snapshot.published} verified judge(s) lacked a publication decision`,
          "repaired", { published });
      } catch (error) {
        await audit(sql, "repair_judge_publication", "verified roster publication was blocked", "failed",
          { error: error instanceof Error ? error.message : String(error) });
      }
    }

    if (assessment.matchingBehind) {
      try {
        const result = await matchJudgesToCases(sql, { limit: 5_000 });
        await audit(sql, "advance_judge_matching",
          `${snapshot.pendingMatches} opinion author observation(s) pending`, "repaired", result);
      } catch (error) {
        await audit(sql, "advance_judge_matching", "judge matching was blocked", "failed",
          { error: error instanceof Error ? error.message : String(error) });
      }
    }

    const pages = await verifyPublicPages(sql);
    await audit(sql, "verify_judge_pages", "end-to-end public directory and profile check",
      pages.directory && pages.profile ? "healthy" : "degraded", pages);

    return getJudgeAutopilotSnapshot(sql);
  } finally {
    await sql`SELECT pg_advisory_unlock(71483621)`;
  }
}
