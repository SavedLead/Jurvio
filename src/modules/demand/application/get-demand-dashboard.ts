import type postgres from "postgres";
import {
  buildDemandRecommendations,
  type DemandRecommendation,
} from "../domain/recommendations";

type Sql = ReturnType<typeof postgres>;

export interface MetricRow {
  label: string;
  value: number;
}

export interface DemandDashboard {
  windowDays: number;
  totalEvents: number;
  previousEvents: number;
  changePercent: number | null;
  humanEvents: number;
  machineEvents: number;
  byVisitorClass: MetricRow[];
  byEventType: MetricRow[];
  topPages: MetricRow[];
  topCases: Array<MetricRow & { publicId: string }>;
  topEntities: Array<MetricRow & { publicId: string; entityType: string }>;
  topCourts: MetricRow[];
  topStates: MetricRow[];
  topCaseTypes: MetricRow[];
  topTopics: MetricRow[];
  topBots: MetricRow[];
  searchDemand: {
    searches: number;
    zeroResults: number;
    queryLength: MetricRow[];
    queryTokens: MetricRow[];
    citationShape: number;
    docketShape: number;
    booleanSyntax: number;
  };
  daily: Array<{
    day: string;
    humans: number;
    searchCrawlers: number;
    aiCrawlers: number;
    agentsAndApis: number;
  }>;
  recommendations: DemandRecommendation[];
}

interface TotalsRow {
  current: number;
  previous: number;
  humans: number;
  searchCrawlers: number;
  aiCrawlers: number;
  agentsAndApis: number;
  searches: number;
  zeroResults: number;
  explanationRequests: number;
  citationShape: number;
  docketShape: number;
  booleanSyntax: number;
}

export async function getDemandDashboard(
  sql: Sql,
  days = 30,
): Promise<DemandDashboard> {
  const boundedDays = [7, 30, 90, 365].includes(days) ? days : 30;
  const [
    totals,
    byVisitorClass,
    byEventType,
    topPages,
    topCases,
    topEntities,
    topCourts,
    topStates,
    topCaseTypes,
    topTopics,
    topBots,
    queryLength,
    queryTokens,
    daily,
  ] = await Promise.all([
    sql<TotalsRow[]>`
      SELECT
        count(*) FILTER (
          WHERE occurred_at >= now() - (${boundedDays} * interval '1 day')
        )::int AS current,
        count(*) FILTER (
          WHERE occurred_at < now() - (${boundedDays} * interval '1 day')
            AND occurred_at >= now() - (${boundedDays * 2} * interval '1 day')
        )::int AS previous,
        count(*) FILTER (
          WHERE occurred_at >= now() - (${boundedDays} * interval '1 day')
            AND visitor_class = 'human'
        )::int AS humans,
        count(*) FILTER (
          WHERE occurred_at >= now() - (${boundedDays} * interval '1 day')
            AND visitor_class = 'search_bot'
        )::int AS "searchCrawlers",
        count(*) FILTER (
          WHERE occurred_at >= now() - (${boundedDays} * interval '1 day')
            AND visitor_class = 'ai_bot'
        )::int AS "aiCrawlers",
        count(*) FILTER (
          WHERE occurred_at >= now() - (${boundedDays} * interval '1 day')
            AND visitor_class IN ('agent', 'api')
        )::int AS "agentsAndApis",
        count(*) FILTER (
          WHERE occurred_at >= now() - (${boundedDays} * interval '1 day')
            AND event_type = 'internal_search'
        )::int AS searches,
        count(*) FILTER (
          WHERE occurred_at >= now() - (${boundedDays} * interval '1 day')
            AND event_type = 'internal_search'
            AND metadata ->> 'resultCount' = '0'
        )::int AS "zeroResults",
        count(*) FILTER (
          WHERE occurred_at >= now() - (${boundedDays} * interval '1 day')
            AND event_type = 'explanation_request'
        )::int AS "explanationRequests",
        count(*) FILTER (
          WHERE occurred_at >= now() - (${boundedDays} * interval '1 day')
            AND metadata ->> 'hasCitationShape' = 'true'
        )::int AS "citationShape",
        count(*) FILTER (
          WHERE occurred_at >= now() - (${boundedDays} * interval '1 day')
            AND metadata ->> 'hasDocketShape' = 'true'
        )::int AS "docketShape",
        count(*) FILTER (
          WHERE occurred_at >= now() - (${boundedDays} * interval '1 day')
            AND metadata ->> 'hasBooleanSyntax' = 'true'
        )::int AS "booleanSyntax"
      FROM demand_event
      WHERE occurred_at >= now() - (${boundedDays * 2} * interval '1 day')
    `,
    sql<MetricRow[]>`
      SELECT visitor_class::text AS label, count(*)::int AS value
      FROM demand_event
      WHERE occurred_at >= now() - (${boundedDays} * interval '1 day')
      GROUP BY visitor_class ORDER BY value DESC
    `,
    sql<MetricRow[]>`
      SELECT event_type::text AS label, count(*)::int AS value
      FROM demand_event
      WHERE occurred_at >= now() - (${boundedDays} * interval '1 day')
      GROUP BY event_type ORDER BY value DESC
    `,
    sql<MetricRow[]>`
      SELECT metadata ->> 'pathTemplate' AS label, count(*)::int AS value
      FROM demand_event
      WHERE occurred_at >= now() - (${boundedDays} * interval '1 day')
        AND metadata ->> 'pathTemplate' IS NOT NULL
      GROUP BY metadata ->> 'pathTemplate'
      ORDER BY value DESC LIMIT 20
    `,
    sql<Array<MetricRow & { publicId: string }>>`
      SELECT legal_case.caption AS label, legal_case.public_id AS "publicId",
        count(*)::int AS value
      FROM demand_event JOIN legal_case ON legal_case.id = demand_event.case_id
      WHERE demand_event.occurred_at >= now() - (${boundedDays} * interval '1 day')
      GROUP BY legal_case.id ORDER BY value DESC LIMIT 20
    `,
    sql<Array<MetricRow & { publicId: string; entityType: string }>>`
      SELECT entity.display_name AS label, entity.public_id AS "publicId",
        entity.entity_type AS "entityType", count(*)::int AS value
      FROM demand_event JOIN entity ON entity.id = demand_event.entity_id
      WHERE demand_event.occurred_at >= now() - (${boundedDays} * interval '1 day')
      GROUP BY entity.id ORDER BY value DESC LIMIT 20
    `,
    sql<MetricRow[]>`
      SELECT court.name AS label, count(*)::int AS value
      FROM demand_event
      JOIN court ON court.id = demand_event.court_id
      WHERE demand_event.occurred_at >= now() - (${boundedDays} * interval '1 day')
      GROUP BY court.id ORDER BY value DESC LIMIT 20
    `,
    sql<MetricRow[]>`
      SELECT metadata ->> 'jurisdiction' AS label, count(*)::int AS value
      FROM demand_event
      WHERE occurred_at >= now() - (${boundedDays} * interval '1 day')
        AND nullif(metadata ->> 'jurisdiction', '') IS NOT NULL
      GROUP BY metadata ->> 'jurisdiction'
      ORDER BY value DESC LIMIT 20
    `,
    sql<MetricRow[]>`
      SELECT metadata ->> 'natureOfSuitCode' AS label, count(*)::int AS value
      FROM demand_event
      WHERE occurred_at >= now() - (${boundedDays} * interval '1 day')
        AND nullif(metadata ->> 'natureOfSuitCode', '') IS NOT NULL
      GROUP BY metadata ->> 'natureOfSuitCode'
      ORDER BY value DESC LIMIT 20
    `,
    sql<MetricRow[]>`
      SELECT metadata ->> 'topic' AS label, count(*)::int AS value
      FROM demand_event
      WHERE occurred_at >= now() - (${boundedDays} * interval '1 day')
        AND nullif(metadata ->> 'topic', '') IS NOT NULL
      GROUP BY metadata ->> 'topic'
      ORDER BY value DESC LIMIT 20
    `,
    sql<MetricRow[]>`
      SELECT COALESCE(bot_family, visitor_class::text) AS label,
        count(*)::int AS value
      FROM demand_event
      WHERE occurred_at >= now() - (${boundedDays} * interval '1 day')
        AND visitor_class IN ('search_bot', 'ai_bot', 'agent', 'api')
      GROUP BY COALESCE(bot_family, visitor_class::text)
      ORDER BY value DESC LIMIT 20
    `,
    sql<MetricRow[]>`
      SELECT metadata ->> 'queryLengthBucket' AS label, count(*)::int AS value
      FROM demand_event
      WHERE occurred_at >= now() - (${boundedDays} * interval '1 day')
        AND event_type = 'internal_search'
        AND metadata ->> 'queryLengthBucket' IS NOT NULL
      GROUP BY metadata ->> 'queryLengthBucket' ORDER BY value DESC
    `,
    sql<MetricRow[]>`
      SELECT metadata ->> 'queryTokenBucket' AS label, count(*)::int AS value
      FROM demand_event
      WHERE occurred_at >= now() - (${boundedDays} * interval '1 day')
        AND event_type = 'internal_search'
        AND metadata ->> 'queryTokenBucket' IS NOT NULL
      GROUP BY metadata ->> 'queryTokenBucket' ORDER BY value DESC
    `,
    sql<Array<{
      day: string;
      humans: number;
      searchCrawlers: number;
      aiCrawlers: number;
      agentsAndApis: number;
    }>>`
      SELECT event_date::text AS day,
        count(*) FILTER (WHERE visitor_class = 'human')::int AS humans,
        count(*) FILTER (WHERE visitor_class = 'search_bot')::int AS "searchCrawlers",
        count(*) FILTER (WHERE visitor_class = 'ai_bot')::int AS "aiCrawlers",
        count(*) FILTER (WHERE visitor_class IN ('agent', 'api'))::int AS "agentsAndApis"
      FROM demand_event
      WHERE occurred_at >= now() - (${boundedDays} * interval '1 day')
      GROUP BY event_date ORDER BY event_date
    `,
  ]);

  const total = totals[0] ?? {
    current: 0,
    previous: 0,
    humans: 0,
    searchCrawlers: 0,
    aiCrawlers: 0,
    agentsAndApis: 0,
    searches: 0,
    zeroResults: 0,
    explanationRequests: 0,
    citationShape: 0,
    docketShape: 0,
    booleanSyntax: 0,
  };
  const machineEvents = total.searchCrawlers + total.aiCrawlers
    + total.agentsAndApis;
  const changePercent = total.previous > 0
    ? Math.round(((total.current - total.previous) / total.previous) * 100)
    : null;

  return {
    windowDays: boundedDays,
    totalEvents: total.current,
    previousEvents: total.previous,
    changePercent,
    humanEvents: total.humans,
    machineEvents,
    byVisitorClass,
    byEventType,
    topPages,
    topCases,
    topEntities,
    topCourts,
    topStates,
    topCaseTypes,
    topTopics,
    topBots,
    searchDemand: {
      searches: total.searches,
      zeroResults: total.zeroResults,
      queryLength,
      queryTokens,
      citationShape: total.citationShape,
      docketShape: total.docketShape,
      booleanSyntax: total.booleanSyntax,
    },
    daily,
    recommendations: buildDemandRecommendations({
      totalEvents: total.current,
      previousEvents: total.previous,
      humanEvents: total.humans,
      searchBotEvents: total.searchCrawlers,
      aiCrawlerEvents: total.aiCrawlers,
      agentAndApiEvents: total.agentsAndApis,
      internalSearches: total.searches,
      zeroResultSearches: total.zeroResults,
      explanationRequests: total.explanationRequests,
      topCourt: topCourts[0],
      topCaseType: topCaseTypes[0],
      topTopic: topTopics[0],
    }),
  };
}
