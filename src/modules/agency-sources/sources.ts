import { DOJ_ADAPTER } from "./providers/doj";
import { FTC_ADAPTER } from "./providers/ftc";
import { SEC_ADAPTERS } from "./providers/sec";
import type { SourceAdapter } from "./providers/context";
import { JND_ADAPTER, SETTLEMENT_SITES_ADAPTER, UNPOLLED_ADMINISTRATOR_ADAPTERS } from "./providers/settlements";
import { STATE_AG_ADAPTERS } from "./providers/state-ag";

/** Every registered agency source, grouped for --source=. */
export const AGENCY_SOURCE_GROUPS: Readonly<Record<string, readonly SourceAdapter[]>> = {
  doj: [DOJ_ADAPTER],
  sec: SEC_ADAPTERS,
  ftc: [FTC_ADAPTER],
  "state-ag": STATE_AG_ADAPTERS,
  // JND first: the settlement websites adapter reads the websites JND lists.
  settlements: [JND_ADAPTER, SETTLEMENT_SITES_ADAPTER, ...UNPOLLED_ADMINISTRATOR_ADAPTERS],
};

export function adaptersFor(group: string): SourceAdapter[] {
  if (group === "all") return Object.values(AGENCY_SOURCE_GROUPS).flat();
  const adapters = AGENCY_SOURCE_GROUPS[group];
  if (!adapters) throw new Error(`unknown --source=${group}; use all or ${Object.keys(AGENCY_SOURCE_GROUPS).join(", ")}`);
  return [...adapters];
}
