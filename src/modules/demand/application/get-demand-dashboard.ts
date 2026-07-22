import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

interface MetricRow {
  label: string;
  value: number;
}

export interface DemandDashboard {
  totalEvents: number;
  byVisitorClass: MetricRow[];
  byEventType: MetricRow[];
  topCases: Array<MetricRow & { publicId: string }>;
  topCourts: MetricRow[];
  topBots: MetricRow[];
  daily: Array<{ day: string; humans: number; machines: number }>;
}

export async function getDemandDashboard(sql: Sql, days = 30): Promise<DemandDashboard> {
  const boundedDays = Math.min(Math.max(days, 1), 365);
  const [total, byVisitorClass, byEventType, topCases, topCourts, topBots, daily] = await Promise.all([
    sql<{ value: number }[]>`
      SELECT count(*)::int AS value FROM demand_event
      WHERE occurred_at >= now() - (${boundedDays} * interval '1 day')
    `,
    sql<MetricRow[]>`
      SELECT visitor_class::text AS label, count(*)::int AS value FROM demand_event
      WHERE occurred_at >= now() - (${boundedDays} * interval '1 day')
      GROUP BY visitor_class ORDER BY value DESC
    `,
    sql<MetricRow[]>`
      SELECT event_type::text AS label, count(*)::int AS value FROM demand_event
      WHERE occurred_at >= now() - (${boundedDays} * interval '1 day')
      GROUP BY event_type ORDER BY value DESC
    `,
    sql<Array<MetricRow & { publicId: string }>>`
      SELECT legal_case.caption AS label, legal_case.public_id AS "publicId", count(*)::int AS value
      FROM demand_event JOIN legal_case ON legal_case.id = demand_event.case_id
      WHERE demand_event.occurred_at >= now() - (${boundedDays} * interval '1 day')
      GROUP BY legal_case.id ORDER BY value DESC LIMIT 20
    `,
    sql<MetricRow[]>`
      SELECT court.name AS label, count(*)::int AS value
      FROM demand_event
      JOIN legal_case ON legal_case.id = demand_event.case_id
      JOIN court ON court.id = legal_case.court_id
      WHERE demand_event.occurred_at >= now() - (${boundedDays} * interval '1 day')
      GROUP BY court.id ORDER BY value DESC LIMIT 20
    `,
    sql<MetricRow[]>`
      SELECT COALESCE(bot_family, visitor_class::text) AS label, count(*)::int AS value
      FROM demand_event
      WHERE occurred_at >= now() - (${boundedDays} * interval '1 day')
        AND visitor_class IN ('search_bot', 'ai_bot', 'agent', 'api')
      GROUP BY COALESCE(bot_family, visitor_class::text) ORDER BY value DESC LIMIT 20
    `,
    sql<Array<{ day: string; humans: number; machines: number }>>`
      SELECT event_date::text AS day,
        count(*) FILTER (WHERE visitor_class = 'human')::int AS humans,
        count(*) FILTER (WHERE visitor_class IN ('search_bot', 'ai_bot', 'agent', 'api'))::int AS machines
      FROM demand_event
      WHERE occurred_at >= now() - (${boundedDays} * interval '1 day')
      GROUP BY event_date ORDER BY event_date
    `,
  ]);
  return {
    totalEvents: total[0]?.value ?? 0,
    byVisitorClass,
    byEventType,
    topCases,
    topCourts,
    topBots,
    daily,
  };
}
