import { z } from "zod";

export const courtListenerDocketSchema = z.object({
  id: z.number().int().positive(),
  resource_uri: z.string(),
  absolute_url: z.string(),
  docket_number: z.string().catch(""),
  docket_number_core: z.string().nullable().optional(),
  case_name: z.string().catch(""),
  case_name_short: z.string().nullable().optional(),
  case_name_full: z.string().nullable().optional(),
  date_filed: z.string().nullable().optional(),
  date_terminated: z.string().nullable().optional(),
  date_last_filing: z.string().nullable().optional(),
  cause: z.string().catch(""),
  nature_of_suit: z.string().catch(""),
  jury_demand: z.string().catch(""),
  assigned_to_str: z.string().catch(""),
  referred_to_str: z.string().catch(""),
  court: z.string(),
  date_modified: z.string(),
}).passthrough();

export type CourtListenerDocket = z.infer<typeof courtListenerDocketSchema>;

export const courtListenerPageSchema = z.object({
  count: z.number().int().nonnegative(),
  next: z.string().nullable(),
  previous: z.string().nullable(),
  results: z.array(courtListenerDocketSchema),
});
