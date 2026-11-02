import { createId } from "@paralleldrive/cuid2";

const prefixes = {
  case: "jv",
  document: "jd",
  docketEntry: "je",
  entity: "jy",
  attorney: "ja",
  judge: "jj",
  firm: "jf",
  court: "jc",
  cluster: "jo",
  governmentLead: "jg",
} as const;

export type PublicIdKind = keyof typeof prefixes;

/** Six or more digits in a row read like a docket, phone or account number. */
const LONG_DIGIT_RUN = /\d{6,}/;
const MAX_ATTEMPTS = 32;

/**
 * The 10-character opaque body of a public ID. Draws from `next` until the body has
 * no run of six or more digits (a draw has one about 0.2% of the time).
 */
export function publicIdBody(next: () => string = createId): string {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const body = next().slice(0, 10);
    if (!LONG_DIGIT_RUN.test(body)) return body;
  }
  throw new Error("could not draw a public ID without a long digit run");
}

export function createPublicId(kind: PublicIdKind): string {
  return `${prefixes[kind]}-${publicIdBody()}`;
}

export function isPublicId(kind: PublicIdKind, value: string): boolean {
  return new RegExp(`^${prefixes[kind]}-[a-z0-9]{8,10}$`).test(value);
}
