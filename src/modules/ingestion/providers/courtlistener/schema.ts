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


export const courtListenerRecapDocumentSchema = z.object({
  id: z.number().int().positive(),
  resource_uri: z.string(),
  document_number: z.string().nullable().optional(),
  attachment_number: z.number().int().nonnegative().nullable().optional(),
  pacer_doc_id: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  document_type: z.string().nullable().optional(),
  page_count: z.number().int().nonnegative().nullable().optional(),
  is_available: z.boolean().default(false),
  filepath_local: z.string().nullable().optional(),
  ocr_status: z.unknown().optional(),
}).passthrough();

export const courtListenerDocketEntrySchema = z.object({
  id: z.number().int().positive(),
  resource_uri: z.string(),
  docket: z.string(),
  docket_id: z.number().int().positive().optional(),
  date_filed: z.string().nullable().optional(),
  entry_number: z.number().int().nonnegative().nullable().optional(),
  description: z.string().catch(""),
  recap_documents: z.array(courtListenerRecapDocumentSchema).default([]),
}).passthrough();

export type CourtListenerDocketEntry = z.infer<typeof courtListenerDocketEntrySchema>;

export const courtListenerPartyTypeSchema = z.object({
  docket_id: z.number().int().positive(),
  name: z.string(),
  date_terminated: z.string().nullable().optional(),
  extra_info: z.string().nullable().optional(),
}).passthrough();

export const courtListenerPartySchema = z.object({
  id: z.number().int().positive(),
  resource_uri: z.string(),
  name: z.string(),
  extra_info: z.string().nullable().optional(),
  party_types: z.array(courtListenerPartyTypeSchema).default([]),
  attorneys: z.array(z.unknown()).default([]),
  date_created: z.string().optional(),
  date_modified: z.string().optional(),
}).passthrough();

export type CourtListenerParty = z.infer<typeof courtListenerPartySchema>;

export const courtListenerPageSchema = z.object({
  count: z.number().int().nonnegative().optional(),
  next: z.string().nullable(),
  previous: z.string().nullable(),
  results: z.array(courtListenerDocketSchema),
});

export const courtListenerPartyPageSchema = z.object({
  count: z.number().int().nonnegative().optional(),
  next: z.string().nullable(),
  previous: z.string().nullable(),
  results: z.array(courtListenerPartySchema),
});

export const courtListenerDocketEntryPageSchema = z.object({
  count: z.number().int().nonnegative().optional(),
  next: z.string().nullable(),
  previous: z.string().nullable(),
  results: z.array(courtListenerDocketEntrySchema),
});
