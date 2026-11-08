/**
 * Compare what the official Court has posted with what a caller already holds.
 * A docket-number frontier is not coverage: numbers below it are unchecked
 * unless the caller supplies them.
 */
import type { OfficialOrderIndexEntry } from "@/modules/ingestion/providers/scotus/official-orders";
import type { RelatingToOrdersOpinion } from "@/modules/ingestion/providers/scotus/official-orders";

export interface SlipOpinionRef {
  termYear: string;
  filedOn: string;
  docketNumber: string;
  caseName: string;
  sourceUrl?: string;
}

export interface FrontierProbe {
  series: string;
  high: string;
  next: string;
  nextStatus: number;
  /** Numbers above `high` that were checked. This is not a scan of every number below `high`. */
  spotChecksAbove: { docket: string; status: number }[];
}

export interface ScotusCoverageInput {
  retrievedAt: string;
  slipOpinions: SlipOpinionRef[];
  orders: OfficialOrderIndexEntry[];
  relating: RelatingToOrdersOpinion[];
  /** Docket numbers already stored, when the caller has them. Omit to leave the comparison unknown. */
  knownDockets?: readonly string[];
  knownOrderRecordIds?: readonly string[];
  frontiers?: FrontierProbe[];
}

export interface ScotusCoverageReport {
  retrievedAt: string;
  slip: { count: number; newest: SlipOpinionRef | null };
  orders: {
    count: number;
    orderLists: number;
    miscellaneous: number;
    newestOrderList: OfficialOrderIndexEntry | null;
    newest: OfficialOrderIndexEntry | null;
  };
  relating: { count: number; withRevision: number; newest: RelatingToOrdersOpinion | null };
  frontiers: FrontierProbe[];
  /** Official rows whose docket or order id the caller does not hold. Empty when the caller passed no inventory. */
  missing: { slip: string[]; orderLists: string[]; relating: string[] } | null;
  unknowns: string[];
}

const UNKNOWNS = [
  "Numbers between 1 and each series frontier were not fetched, so gaps inside the range are unknown.",
  "Production case, order, and opinion rows were not counted by this report.",
  "Order-list PDF text is not coverage until that PDF has been fetched and parsed.",
  "A frontier or an index date does not mean every filing, order, or opinion in the term is stored.",
];

function newestBy<T>(rows: readonly T[], date: (row: T) => string): T | null {
  return rows.reduce<T | null>((best, row) => (!best || date(row) > date(best) ? row : best), null);
}

export function buildScotusCoverageReport(input: ScotusCoverageInput): ScotusCoverageReport {
  const orderLists = input.orders.filter((entry) => entry.kind === "order_list");
  const known = input.knownDockets ? new Set(input.knownDockets.map((value) => value.toUpperCase())) : null;
  const knownOrders = input.knownOrderRecordIds ? new Set(input.knownOrderRecordIds) : null;
  const missing = known || knownOrders
    ? {
        slip: known ? input.slipOpinions.filter((row) => !known.has(row.docketNumber.toUpperCase())).map((row) => row.docketNumber) : [],
        orderLists: knownOrders ? orderLists.filter((entry) => !knownOrders.has(entry.sourceRecordId)).map((entry) => entry.sourceRecordId) : [],
        relating: known ? input.relating.filter((row) => !known.has(row.docketNumber.toUpperCase())).map((row) => row.docketNumber) : [],
      }
    : null;
  return {
    retrievedAt: input.retrievedAt,
    slip: { count: input.slipOpinions.length, newest: newestBy(input.slipOpinions, (row) => row.filedOn) },
    orders: {
      count: input.orders.length,
      orderLists: orderLists.length,
      miscellaneous: input.orders.filter((entry) => entry.kind === "miscellaneous").length,
      newestOrderList: newestBy(orderLists, (entry) => entry.listDate),
      newest: newestBy(input.orders, (entry) => entry.listDate),
    },
    relating: {
      count: input.relating.length,
      withRevision: input.relating.filter((row) => row.revision).length,
      newest: newestBy(input.relating, (row) => row.revision && row.revision.listDate > row.listDate ? row.revision.listDate : row.listDate),
    },
    frontiers: input.frontiers ?? [],
    missing,
    unknowns: [...UNKNOWNS],
  };
}
