import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type postgres from "postgres";

type Sql = ReturnType<typeof postgres>;
const execFileAsync = promisify(execFile);

interface ExtractionCandidate {
  document_id: string;
  document_public_id: string;
  case_id: string;
  case_public_id: string;
  court_id: string;
  cluster_id: string;
  case_caption: string;
  court_name: string;
  docket_number: string;
  official_citation: string | null;
  title: string;
  filed_on: string | null;
  precedential_status: string | null;
  opinion_type: string;
  citation_count: number;
  content_hash: string;
  object_key: string;
  source_artifact_id: string;
  source_download_url: string;
  source_page_start: number | null;
  source_page_end: number | null;
  next_source_page_start: number | null;
}

export function validateOfficialScotusText(text: string, docketNumber: string) {
  const normalized = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();
  const words = normalized.split(/\s+/).filter(Boolean);
  const letters = [...normalized].filter((character) => /[A-Za-z]/.test(character)).length;
  const replacementCharacters = [...normalized].filter((character) => character === "\uFFFD").length;
  const nonWhitespaceCharacters = [...normalized].filter((character) => !/\s/.test(character)).length;
  const normalizedDocket = docketNumber.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
  const normalizedText = normalized.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
  const hasCourtMarker = /supreme court of the united states/i.test(normalized);
  const hasDocket = normalizedDocket.length > 3 && normalizedText.includes(normalizedDocket);
  const letterDensity = letters / Math.max(nonWhitespaceCharacters, 1);
  const hasSubstantialOfficialText = words.length >= 5_000;
  const hasVerifiedNumericDecree = words.length >= 15_000 && hasDocket && letterDensity >= 0.35;
  const valid = words.length >= 150
    && (letterDensity >= 0.55 || hasVerifiedNumericDecree)
    && replacementCharacters / Math.max(normalized.length, 1) < 0.001
    && (hasCourtMarker || hasDocket || hasSubstantialOfficialText);
  return { valid, normalized, wordCount: words.length };
}

export function resolveOfficialScotusPageEnd(
  explicitPageEnd: number | null,
  nextPageStart: number | null,
) {
  if (explicitPageEnd !== null) return explicitPageEnd;
  return nextPageStart !== null ? nextPageStart - 1 : null;
}

export function trimOfficialScotusBoundVolumeText(
  text: string,
  officialCitation: string | null,
) {
  if (officialCitation === null) return text;
  const normalizedCitation = officialCitation.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
  const citationMarker = `citeas${normalizedCitation}`;
  const pages = text.split("\f");
  const retained: string[] = [];
  let sawOwnCitation = false;
  for (const page of pages) {
    const normalizedPage = page.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
    const hasOwnCitation = normalizedPage.includes(citationMarker);
    if (sawOwnCitation && !hasOwnCitation && /october\s+term,\s*20\d{2}/i.test(page)) break;
    retained.push(page);
    if (hasOwnCitation) sawOwnCitation = true;
  }
  return sawOwnCitation ? retained.join("\f") : text;
}

export function officialOpinionTextToHtml(text: string) {
  const escape = (value: string) => value
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  return text.split(/\n\s*\n+/)
    .map((paragraph) => paragraph.replaceAll(/\s*\n\s*/g, " ").replaceAll(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escape(paragraph)}</p>`)
    .join("\n");
}

export async function extractOfficialScotusOpinionText(
  sql: Sql,
  options: { limit: number; artifactRoot: string },
) {
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100_000) {
    throw new Error("Extraction limit must be between 1 and 100000");
  }
  const artifactRoot = path.resolve(options.artifactRoot);
  const candidates = await sql<ExtractionCandidate[]>`
    SELECT document.id AS document_id, document.public_id AS document_public_id,
      legal_case.id AS case_id, legal_case.public_id AS case_public_id,
      court.id AS court_id, cluster.id AS cluster_id, legal_case.caption AS case_caption,
      court.name AS court_name, legal_case.docket_number, legal_case.official_citation,
      document.title,
      document.filed_on::text AS filed_on, cluster.precedential_status,
      judicial.opinion_type, cluster.citation_count, artifact.content_hash,
      artifact.object_key, artifact.id AS source_artifact_id,
      judicial.source_download_url, candidate.source_page_start, candidate.source_page_end,
      next_candidate.source_page_start AS next_source_page_start
    FROM document
    JOIN document_identifier identifier ON identifier.document_id = document.id
      AND identifier.identifier_type = 'scotus_official_opinion'
    JOIN official_opinion_candidate candidate
      ON candidate.provider_id = identifier.provider_id
     AND candidate.source_record_id = identifier.identifier_value
    JOIN legal_case ON legal_case.id = document.case_id
    JOIN court ON court.id = legal_case.court_id
    JOIN judicial_opinion judicial ON judicial.document_id = document.id
    JOIN opinion_cluster cluster ON cluster.id = judicial.cluster_id
    JOIN raw_artifact artifact ON artifact.id = document.source_artifact_id
    LEFT JOIN LATERAL (
      SELECT MIN(other_candidate.source_page_start)::integer AS source_page_start
      FROM official_opinion_candidate other_candidate
      JOIN document_identifier other_identifier
        ON other_identifier.provider_id = other_candidate.provider_id
       AND other_identifier.identifier_type = 'scotus_official_opinion'
       AND other_identifier.identifier_value = other_candidate.source_record_id
      JOIN document other_document ON other_document.id = other_identifier.document_id
      JOIN judicial_opinion other_judicial ON other_judicial.document_id = other_document.id
      WHERE split_part(other_judicial.source_download_url, '#', 1)
          = split_part(judicial.source_download_url, '#', 1)
        AND other_candidate.source_page_start > candidate.source_page_start
    ) next_candidate ON true
    LEFT JOIN document_content content ON content.document_id = document.id
    WHERE document.publication = 'published'
      AND legal_case.publication = 'published'
      AND content.document_id IS NULL
    ORDER BY document.filed_on, document.id
    LIMIT ${options.limit}
  `;

  let extracted = 0;
  let held = 0;
  let failed = 0;
  const records: Array<{ caseId: string; documentId: string; words?: number; reason?: string }> = [];

  for (const candidate of candidates) {
    try {
      const sourcePath = path.resolve(artifactRoot, candidate.object_key);
      if (sourcePath !== artifactRoot && !sourcePath.startsWith(artifactRoot + path.sep)) {
        throw new Error("Artifact path escaped configured root");
      }
      let pdf: Buffer;
      try {
        pdf = await readFile(sourcePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const sourceUrl = new URL(candidate.source_download_url);
        if (sourceUrl.protocol !== "https:"
          || !["www.supremecourt.gov", "supremecourt.gov"].includes(sourceUrl.hostname)) {
          throw new Error("Missing artifact has no permitted official Supreme Court source");
        }
        const response = await fetch(sourceUrl, {
          headers: { "User-Agent": "Jurvio legal research ingestion contact@jurvio.com" },
          signal: AbortSignal.timeout(120_000),
        });
        if (!response.ok) throw new Error(`Official PDF recovery failed: ${response.status} ${response.statusText}`);
        pdf = Buffer.from(await response.arrayBuffer());
        if (pdf.length < 5 || pdf.subarray(0, 5).toString("ascii") !== "%PDF-") {
          throw new Error("Recovered official source is not a PDF");
        }
        const recoveredHash = createHash("sha256").update(pdf).digest("hex");
        if (recoveredHash !== candidate.content_hash) {
          throw new Error("Recovered official PDF checksum mismatch");
        }
        await mkdir(path.dirname(sourcePath), { recursive: true });
        await writeFile(sourcePath, pdf, { flag: "wx" }).catch((writeError: NodeJS.ErrnoException) => {
          if (writeError.code !== "EEXIST") throw writeError;
        });
      }
      const hash = createHash("sha256").update(pdf).digest("hex");
      if (hash !== candidate.content_hash) throw new Error("Official PDF checksum mismatch");
      const extractionArgs: string[] = [];
      if (candidate.source_page_start !== null) {
        extractionArgs.push("-f", String(candidate.source_page_start));
        const resolvedPageEnd = resolveOfficialScotusPageEnd(
          candidate.source_page_end,
          candidate.next_source_page_start,
        );
        if (resolvedPageEnd !== null) {
          extractionArgs.push("-l", String(resolvedPageEnd));
        }
      }
      const pageArgs = [...extractionArgs];
      const { stdout: layoutText } = await execFileAsync(
        "pdftotext",
        [...pageArgs, "-layout", sourcePath, "-"],
        { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 120_000 },
      );
      const structurallyBoundLayoutText = trimOfficialScotusBoundVolumeText(
        layoutText,
        candidate.official_citation,
      );
      let validation = validateOfficialScotusText(
        structurallyBoundLayoutText,
        candidate.docket_number,
      );
      let usedRawReadingOrder = false;
      if (!validation.valid) {
        const { stdout: rawText } = await execFileAsync(
          "pdftotext",
          [...pageArgs, "-raw", sourcePath, "-"],
          { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 120_000 },
        );
        const structurallyBoundRawText = trimOfficialScotusBoundVolumeText(
          rawText,
          candidate.official_citation,
        );
        const rawValidation = validateOfficialScotusText(
          structurallyBoundRawText,
          candidate.docket_number,
        );
        if (rawValidation.valid) {
          validation = rawValidation;
          usedRawReadingOrder = true;
        } else {
          held += 1;
          records.push({ caseId: candidate.case_public_id, documentId: candidate.document_public_id,
            reason: `Native layout/raw validation failed (${validation.wordCount}/${rawValidation.wordCount} words); OCR required` });
          continue;
        }
      }
      const contentHash = createHash("sha256").update(validation.normalized).digest("hex");
      const contentHtml = officialOpinionTextToHtml(validation.normalized);
      await sql.begin(async (tx) => {
        await tx`
          INSERT INTO document_content (
            document_id, content_html, content_text, content_hash, extraction_method,
            word_count, source_artifact_id
          ) VALUES (
            ${candidate.document_id}, ${contentHtml}, ${validation.normalized}, ${contentHash},
            'native_pdf_text', ${validation.wordCount}, ${candidate.source_artifact_id}
          )
          ON CONFLICT (document_id) DO UPDATE SET
            content_html = EXCLUDED.content_html, content_text = EXCLUDED.content_text,
            content_hash = EXCLUDED.content_hash, extraction_method = EXCLUDED.extraction_method,
            word_count = EXCLUDED.word_count, source_artifact_id = EXCLUDED.source_artifact_id,
            updated_at = now()
        `;
        await tx`
          UPDATE document SET extraction_confidence = 0.980, content_hash = ${contentHash},
            updated_at = now() WHERE id = ${candidate.document_id}
        `;
        await tx`
          INSERT INTO opinion_search_projection (
            document_id, case_id, court_id, cluster_id, title, case_caption,
            court_name, date_filed, precedential_status, opinion_type, citation_count, body
          ) VALUES (
            ${candidate.document_id}, ${candidate.case_id}, ${candidate.court_id},
            ${candidate.cluster_id}, ${candidate.title}, ${candidate.case_caption},
            ${candidate.court_name}, ${candidate.filed_on}, ${candidate.precedential_status},
            ${candidate.opinion_type}, ${candidate.citation_count}, ${validation.normalized}
          )
          ON CONFLICT (document_id) DO UPDATE SET body = EXCLUDED.body,
            title = EXCLUDED.title, case_caption = EXCLUDED.case_caption,
            date_filed = EXCLUDED.date_filed, updated_at = now()
        `;
        await tx`
          INSERT INTO outbox_event (
            topic, aggregate_type, aggregate_id, aggregate_version, payload
          ) VALUES (
            'publication.changed', 'document', ${candidate.document_id},
            (extract(epoch from clock_timestamp()) * 1000000)::bigint,
            ${tx.json({ source: "scotus_official", extractionMethod: "native_pdf_text",
              readingOrder: usedRawReadingOrder ? "raw" : "layout",
              wordCount: validation.wordCount, contentHash })}
          )
        `;
      });
      extracted += 1;
      records.push({ caseId: candidate.case_public_id, documentId: candidate.document_public_id,
        words: validation.wordCount });
    } catch (error) {
      failed += 1;
      records.push({ caseId: candidate.case_public_id, documentId: candidate.document_public_id,
        reason: error instanceof Error ? error.message : "Extraction failed" });
    }
  }
  return { selected: candidates.length, extracted, held, failed, records };
}
