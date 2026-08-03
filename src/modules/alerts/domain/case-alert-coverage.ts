export const alertEventTypes = [
  "docket_entry",
  "filing",
  "document",
  "order",
  "opinion",
  "hearing",
  "deadline",
  "disposition",
] as const;

export type AlertEventType = (typeof alertEventTypes)[number];
export type AlertCoverageState = "available" | "limited" | "degraded" | "unavailable";

export interface CaseAlertSource {
  kind: "official_court" | "pacer" | "recap" | "courtlistener" | "govinfo";
  url: string;
  isDirect: boolean;
}

export interface CaseAlertCoverage {
  state: AlertCoverageState;
  eventTypes: AlertEventType[];
  sources: CaseAlertSource[];
  lastCheckedAt: string | null;
  expectedFreshnessMinutes: number | null;
  disclosure: string;
}

export interface CaseAlertCoverageInput {
  courtName: string;
  officialDocketUrl: string | null;
  sourceHealth?: "healthy" | "degraded" | "stale";
  lastCheckedAt?: string | null;
}

function officialSource(url: string): CaseAlertSource | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    const host = parsed.hostname.toLowerCase();
    if (host === "supremecourt.gov" || host.endsWith(".supremecourt.gov")) {
      return { kind: "official_court", url: parsed.toString(), isDirect: true };
    }
    return null;
  } catch {
    return null;
  }
}

export function determineCaseAlertCoverage(input: CaseAlertCoverageInput): CaseAlertCoverage {
  const source = input.officialDocketUrl ? officialSource(input.officialDocketUrl) : null;
  if (!source) {
    return {
      state: "unavailable",
      eventTypes: [],
      sources: [],
      lastCheckedAt: input.lastCheckedAt ?? null,
      expectedFreshnessMinutes: null,
      disclosure: "Alerts are not available until Jurvio verifies an ongoing case-specific update source.",
    };
  }

  const isScotus = /supreme court of the united states/i.test(input.courtName);
  if (!isScotus) {
    return {
      state: "unavailable",
      eventTypes: [],
      sources: [source],
      lastCheckedAt: input.lastCheckedAt ?? null,
      expectedFreshnessMinutes: null,
      disclosure: "This official source is saved, but its supported update types have not yet been verified.",
    };
  }

  if (input.sourceHealth === "stale") {
    return {
      state: "unavailable",
      eventTypes: [],
      sources: [source],
      lastCheckedAt: input.lastCheckedAt ?? null,
      expectedFreshnessMinutes: null,
      disclosure: "Alerts are temporarily unavailable because the official source is stale.",
    };
  }

  const degraded = input.sourceHealth === "degraded";
  return {
    state: degraded ? "degraded" : "available",
    eventTypes: ["docket_entry", "filing", "document", "order", "opinion", "hearing", "deadline", "disposition"],
    sources: [source],
    lastCheckedAt: input.lastCheckedAt ?? null,
    expectedFreshnessMinutes: degraded ? null : 15,
    disclosure: degraded
      ? "Official Supreme Court monitoring is delayed. Jurvio will not describe these alerts as real time."
      : "Available updates are limited to changes Jurvio verifies on the official Supreme Court case source.",
  };
}

export function canOfferCaseAlerts(coverage: CaseAlertCoverage) {
  return coverage.state !== "unavailable" && coverage.eventTypes.length > 0;
}
