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
} as const;

export type PublicIdKind = keyof typeof prefixes;

export function createPublicId(kind: PublicIdKind): string {
  return `${prefixes[kind]}-${createId().slice(0, 10)}`;
}

export function isPublicId(kind: PublicIdKind, value: string): boolean {
  return new RegExp(`^${prefixes[kind]}-[a-z0-9]{8,10}$`).test(value);
}
