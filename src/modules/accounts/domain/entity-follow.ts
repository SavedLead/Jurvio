// Judge / topic / party follows: kinds, alert frequency and the customer copy
// about timing. Copy must never promise "instant" alerts: Jurvio only sees a
// filing when it next checks that court.

export const ENTITY_KINDS = ["judge", "topic", "party", "emergency"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export const ENTITY_FREQUENCIES = ["asap", "daily"] as const;
export type EntityFrequency = (typeof ENTITY_FREQUENCIES)[number];

export function isEntityKind(value: unknown): value is EntityKind {
  return typeof value === "string" && (ENTITY_KINDS as readonly string[]).includes(value);
}

export function isEntityFrequency(value: unknown): value is EntityFrequency {
  return typeof value === "string" && (ENTITY_FREQUENCIES as readonly string[]).includes(value);
}

export const KIND_LABEL: Readonly<Record<EntityKind, string>> = { judge: "Judge", topic: "Topic", party: "Party", emergency: "Emergency docket" };

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
export const TIMING_NOTE = "Jurvio checks federal appeals courts every 5 to 60 minutes, district courts about every 2 hours, open Supreme Court emergency applications about every 10 minutes and the rest of the Supreme Court docket about every 3 hours. Alert emails go out every 10 minutes after a match is found, so a new filing usually reaches you within minutes to a few hours, not instantly.";

/** Judge page note when no public case is linked to the judge yet. */
export const JUDGE_NO_CASES_NOTE = "Jurvio has not linked any public cases to this judge yet, so this follow stays quiet until it does.";

/** "N matches since you followed" for follows younger than the 7-day window, else "N matches in the last 7 days". */
export function matchesSinceLabel(count: number, createdAt: string, now: Date = new Date()): string {
  const noun = count === 1 ? "match" : "matches";
  const created = new Date(createdAt.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
  const young = !Number.isNaN(created.getTime()) && now.getTime() - created.getTime() < 7 * 24 * 3600 * 1000;
  return young ? `${count.toLocaleString("en-US")} ${noun} since you followed (only new filings count, not earlier ones)` : `${count.toLocaleString("en-US")} ${noun} in the last 7 days`;
}

/** What a follow alerts on, per kind. */
export const KIND_EXPLAINER: Readonly<Record<EntityKind, string>> = {
  judge: "New filings, opinions and newly linked cases among the public cases Jurvio has linked to this judge (as opinion author or appeals panel member). Cases the judge handles that Jurvio has not linked are not matched.",
  topic: "New cases, filings and decisions in public cases with this nature of suit.",
  party: "New cases, filings and decisions in public cases that name this party.",
  emergency: "New Supreme Court emergency applications and each new step in them (responses requested, administrative stays, referrals, rulings), with a plain-English line. Routine requests for more time to file are never sent.",
};
