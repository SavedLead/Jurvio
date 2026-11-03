// Judge / topic / party follows: kinds, alert frequency and the customer copy
// about timing. Copy must never promise "instant" alerts: Jurvio only sees a
// filing when it next checks that court.

export const ENTITY_KINDS = ["judge", "topic", "party"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export const ENTITY_FREQUENCIES = ["asap", "daily"] as const;
export type EntityFrequency = (typeof ENTITY_FREQUENCIES)[number];

export function isEntityKind(value: unknown): value is EntityKind {
  return typeof value === "string" && (ENTITY_KINDS as readonly string[]).includes(value);
}

export function isEntityFrequency(value: unknown): value is EntityFrequency {
  return typeof value === "string" && (ENTITY_FREQUENCIES as readonly string[]).includes(value);
}

export const KIND_LABEL: Readonly<Record<EntityKind, string>> = { judge: "Judge", topic: "Topic", party: "Party" };

export const FREQUENCY_LABEL: Readonly<Record<EntityFrequency, string>> = {
  asap: "As soon as Jurvio finds a match",
  daily: "Daily digest",
};

/** Short form for buttons and lists. */
export const FREQUENCY_SHORT: Readonly<Record<EntityFrequency, string>> = {
  asap: "As found",
  daily: "Daily",
};

/** How long a match takes to reach you. Matches the real court check intervals. */
export const TIMING_NOTE = "Jurvio checks federal appeals courts every 5 to 60 minutes, district courts about every 2 hours and the Supreme Court docket about every 3 hours. Alert emails go out every 10 minutes after a match is found, so a new filing usually reaches you within a few hours, not instantly.";

/** What a follow alerts on, per kind. */
export const KIND_EXPLAINER: Readonly<Record<EntityKind, string>> = {
  judge: "New cases assigned to this judge and new filings and decisions in their public cases.",
  topic: "New cases, filings and decisions in public cases with this nature of suit.",
  party: "New cases, filings and decisions in public cases that name this party.",
};
