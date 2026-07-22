import type { CourtListenerDocketEntry } from "../providers/courtlistener/schema";

export interface NormalizedDocketDocument {
  sourceDocumentId: string;
  sourceUri: string;
  documentNumber?: string;
  attachmentNumber?: number;
  pacerDocumentId?: string;
  description?: string;
  documentType?: string;
  pageCount?: number;
  isAvailable: boolean;
  sourceFilePath?: string;
}

export interface NormalizedDocketEntry {
  sourceEntryId: string;
  sourceUri: string;
  entryNumber?: string;
  filedOn?: string;
  description: string;
  documents: NormalizedDocketDocument[];
}

function present(value: string | null | undefined): string | undefined {
  const normalized = value?.normalize("NFKC").replace(/\s+/g, " ").trim();
  return normalized || undefined;
}

function dateOnly(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed.toISOString().slice(0, 10);
}

export function normalizeCourtListenerDocketEntry(
  source: CourtListenerDocketEntry,
): NormalizedDocketEntry {
  const sourceUri = present(source.resource_uri);
  if (!sourceUri) throw new Error("CourtListener docket entry is missing resource_uri");

  const description = present(source.description);
  if (!description && source.recap_documents.length === 0) {
    throw new Error("CourtListener docket entry contains no useful public content");
  }

  return {
    sourceEntryId: String(source.id),
    sourceUri,
    entryNumber: source.entry_number == null ? undefined : String(source.entry_number),
    filedOn: dateOnly(source.date_filed),
    description: description ?? "Document entry",
    documents: source.recap_documents.map((document) => {
      const documentUri = present(document.resource_uri);
      if (!documentUri) throw new Error("CourtListener document is missing resource_uri");
      return {
        sourceDocumentId: String(document.id),
        sourceUri: documentUri,
        documentNumber: present(document.document_number),
        attachmentNumber: document.attachment_number ?? undefined,
        pacerDocumentId: present(document.pacer_doc_id),
        description: present(document.description),
        documentType: present(document.document_type),
        pageCount: document.page_count ?? undefined,
        isAvailable: document.is_available,
        sourceFilePath: present(document.filepath_local),
      };
    }),
  };
}
