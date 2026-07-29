import { createHash } from "node:crypto";
import { z } from "zod";
import { openBulkCsv, parseBulkCsv } from "./bulk";

const nullableBulkString = z.string().transform((value) => value === "" ? null : value);

export const courtListenerBulkDocketSchema = z.object({
  id: z.string().regex(/^\d+$/),
  court_id: z.string().min(1),
  docket_number: z.string(),
  docket_number_core: nullableBulkString.optional(),
  case_name: z.string(),
  case_name_short: nullableBulkString.optional(),
  case_name_full: nullableBulkString.optional(),
  date_filed: nullableBulkString.optional(),
  date_terminated: nullableBulkString.optional(),
  date_last_filing: nullableBulkString.optional(),
  cause: z.string().optional().default(""),
  nature_of_suit: z.string().optional().default(""),
  jury_demand: z.string().optional().default(""),
  assigned_to_str: z.string().optional().default(""),
  referred_to_str: z.string().optional().default(""),
  date_modified: z.string(),
}).passthrough();

export type CourtListenerBulkDocket = z.infer<typeof courtListenerBulkDocketSchema>;

export function bulkDocketSourceUri(snapshotDate: string, docketId: string): string {
  return `https://www.courtlistener.com/help/api/bulk-data/#docket-${snapshotDate}-${docketId}`;
}

export function bulkDocketContentHash(docket: CourtListenerBulkDocket): string {
  return createHash("sha256").update(JSON.stringify(docket)).digest("hex");
}

export async function* readBulkDockets(filePath: string) {
  const source = openBulkCsv(filePath);
  try {
    yield* parseBulkCsv(source.stream, courtListenerBulkDocketSchema);
    await source.completion;
  } finally {
    source.close();
  }
}
