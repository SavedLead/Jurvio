import { DOJ_ADAPTER } from "./providers/doj";
import { FTC_ADAPTER } from "./providers/ftc";
import { SEC_ADAPTERS } from "./providers/sec";
import type { SourceAdapter } from "./providers/context";

/** Every registered agency source, grouped for --source=. */
export const AGENCY_SOURCE_GROUPS: Readonly<Record<string, readonly SourceAdapter[]>> = {
  doj: [DOJ_ADAPTER],
  sec: SEC_ADAPTERS,
  ftc: [FTC_ADAPTER],
};

export function adaptersFor(group: string): SourceAdapter[] {
  if (group === "all") return Object.values(AGENCY_SOURCE_GROUPS).flat();
  const adapters = AGENCY_SOURCE_GROUPS[group];
  if (!adapters) throw new Error(`unknown --source=${group}; use all or ${Object.keys(AGENCY_SOURCE_GROUPS).join(", ")}`);
  return [...adapters];
}
