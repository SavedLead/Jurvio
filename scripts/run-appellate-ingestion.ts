import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { closeDb, db } from "@/db/client";
import { discoverOfficialAppellateOpinions } from "@/modules/ingestion/application/discover-official-appellate-opinions";
import {
  APPELLATE_COURT_REGISTRY,
  appellateCourtByCode,
  fairAppellateOrder,
} from "@/modules/ingestion/providers/appellate/registry";

const argument = (name: string) =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const courtArgument = argument("court") ?? "all";
const watch = (argument("watch") ?? "false") === "true";
const concurrency = Math.max(1, Math.min(6, Number(argument("concurrency") ?? "4")));
const processLimit = Math.max(1, Math.min(2_000, Number(argument("limit") ?? "500")));
const intervalMs = 5 * 60 * 1000;
const sql = db();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const execFileAsync = promisify(execFile);
const artifactRoot = path.resolve(
  process.env.JURVIO_ARTIFACT_ROOT ?? process.env.RAW_ARTIFACT_DIR ?? ".data/artifacts",
);

function textToHtml(text: string) {
  const escape = (value: string) => value
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  return text.split(/\n\s*\n+/)
    .map((paragraph) => paragraph.replaceAll(/\s*\n\s*/g, " ").replaceAll(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escape(paragraph)}</p>`)
    .join("\n");
}

function validateAppellateText(text: string, docketNumber: string) {
  const normalized = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();
  const words = normalized.split(/\s+/).filter(Boolean);
  const letters = [...normalized].filter((character) => /[A-Za-z]/.test(character)).length;
  const visible = [...normalized].filter((character) => !/\s/.test(character)).length;
  const docket = docketNumber.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
  const body = normalized.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
  const valid = words.length >= 150
    && letters / Math.max(visible, 1) >= 0.55
    && (body.includes(docket) || /united states court of appeals/i.test(normalized));
  return { valid, normalized, wordCount: words.length };
}

async function heartbeat(
  stage: string,
  courtCode: string | null,
  metadata: Record<string, unknown> = {},
) {
  const serializedMetadata = JSON.parse(JSON.stringify(metadata));
  await sql`
    INSERT INTO appellate_worker_heartbeat (
      worker_id, stage, court_code, heartbeat_at, metadata
    ) VALUES (
      'appellate-discovery-1', ${stage}, ${courtCode}, now(), ${sql.json(serializedMetadata)}
    )
    ON CONFLICT (worker_id) DO UPDATE SET
      stage = EXCLUDED.stage,
      court_code = EXCLUDED.court_code,
      heartbeat_at = now(),
      metadata = EXCLUDED.metadata
  `;
}

async function downloadAndExtract(item: {
  id: string; court_code: string; docket_number: string | null; document_url: string;
}) {
  if (!item.docket_number) {
    await sql`UPDATE appellate_ingestion_item SET state='blocked',
      blocker_code='missing_docket_number',
      blocker_detail='Official listing did not expose a docket number',
      next_action='Use the court-specific listing adapter to recover the docket number'
      WHERE id=${item.id}`;
    return { state: "blocked", reason: "missing_docket_number" };
  }

  const matches = await sql<{
    case_id: string; case_public_id: string; case_publication: string;
    court_id: string; court_name: string; provider_id: string;
    document_id: string | null; cluster_id: string | null;
    document_publication: string | null; title: string | null;
    caption: string; decided_on: string | null; opinion_type: string | null;
    precedential_status: string | null; citation_count: number | null;
  }[]>`
    SELECT legal_case.id AS case_id, legal_case.public_id AS case_public_id,
      legal_case.publication::text AS case_publication, court.id AS court_id,
      court.name AS court_name, court.provider_id, legal_case.caption,
      legal_case.decided_on::text, document.id AS document_id,
      document.publication::text AS document_publication, document.title,
      cluster.id AS cluster_id, judicial.opinion_type,
      cluster.precedential_status, cluster.citation_count
    FROM legal_case
    JOIN court ON court.id=legal_case.court_id
    LEFT JOIN LATERAL (
      SELECT document.id, document.publication, document.title
      FROM document WHERE document.case_id=legal_case.id
        AND document.document_type='judicial_opinion'
      ORDER BY document.filed_on DESC NULLS LAST, document.id LIMIT 1
    ) document ON true
    LEFT JOIN judicial_opinion judicial ON judicial.document_id=document.id
    LEFT JOIN opinion_cluster cluster ON cluster.id=judicial.cluster_id
    WHERE lower(coalesce(court.provider_court_id,''))=${item.court_code}
      AND lower(regexp_replace(legal_case.docket_number,'[^a-zA-Z0-9]','','g'))
        = lower(regexp_replace(${item.docket_number},'[^a-zA-Z0-9]','','g'))
    ORDER BY (legal_case.publication='published') DESC, legal_case.updated_at DESC
    LIMIT 2
  `;

  if (matches.length !== 1 || !matches[0]?.document_id || !matches[0]?.cluster_id) {
    const blocker = matches.length > 1 ? "ambiguous_case_match"
      : matches.length === 0 ? "canonical_case_missing" : "canonical_opinion_missing";
    await sql`UPDATE appellate_ingestion_item SET state='blocked',
      blocker_code=${blocker},
      blocker_detail=${`Official docket ${item.docket_number} matched ${matches.length} usable Jurvio opinions`},
      next_action='Reconcile through the existing CourtListener bulk case lane, then retry this item'
      WHERE id=${item.id}`;
    return { state: "blocked", reason: blocker };
  }
  const match = matches[0];
  if (!match?.document_id || !match.cluster_id) throw new Error("Canonical opinion match disappeared");

  const response = await fetch(item.document_url, {
    headers: { "User-Agent": process.env.INGESTION_USER_AGENT
      ?? "Jurvio legal research ingestion contact@jurvio.com" },
    redirect: "follow",
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`Official PDF returned HTTP ${response.status}`);
  const pdf = Buffer.from(await response.arrayBuffer());
  if (pdf.length < 5 || pdf.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("Official document response is not a PDF");
  }
  const pdfHash = createHash("sha256").update(pdf).digest("hex");
  const objectKey = `official-appellate/${item.court_code}/${pdfHash}.pdf`;
  const destination = path.resolve(artifactRoot, objectKey);
  if (!destination.startsWith(artifactRoot + path.sep)) throw new Error("Artifact path escaped root");
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, pdf, { flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
  const stored = await readFile(destination);
  if (createHash("sha256").update(stored).digest("hex") !== pdfHash) {
    throw new Error("Stored official PDF checksum mismatch");
  }

  const { stdout } = await execFileAsync("pdftotext", ["-layout", destination, "-"], {
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 120_000,
  });
  const validation = validateAppellateText(stdout, item.docket_number);
  if (!validation.valid) {
    await sql`UPDATE appellate_ingestion_item SET state='blocked',
      document_content_hash=${pdfHash}, blocker_code='ocr_required',
      blocker_detail=${`Native extraction produced only ${validation.wordCount} validated words`},
      next_action='Send only this PDF to the selective OCR lane'
      WHERE id=${item.id}`;
    return { state: "blocked", reason: "ocr_required" };
  }

  const textHash = createHash("sha256").update(validation.normalized).digest("hex");
  const html = textToHtml(validation.normalized);
  await sql.begin(async (tx) => {
    const [artifact] = await tx<{ id: string }[]>`
      INSERT INTO raw_artifact (
        provider_id, source_uri, source_record_id, content_hash, object_key,
        media_type, retrieved_at, response_metadata
      ) VALUES (
        ${match.provider_id}, ${item.document_url}, ${item.id}, ${pdfHash}, ${objectKey},
        'application/pdf', now(),
        ${tx.json({ source: "official_appellate", courtCode: item.court_code })}
      )
      ON CONFLICT (provider_id, source_uri, content_hash)
      DO UPDATE SET retrieved_at=EXCLUDED.retrieved_at
      RETURNING id
    `;
    if (!artifact) throw new Error("Official appellate artifact was not persisted");
    await tx`
      INSERT INTO document_content (
        document_id, content_html, content_text, content_hash, extraction_method,
        word_count, source_artifact_id
      ) VALUES (
        ${match.document_id}, ${html}, ${validation.normalized}, ${textHash},
        'native_pdf_text', ${validation.wordCount}, ${artifact.id}
      )
      ON CONFLICT (document_id) DO UPDATE SET
        content_html=EXCLUDED.content_html, content_text=EXCLUDED.content_text,
        content_hash=EXCLUDED.content_hash, extraction_method=EXCLUDED.extraction_method,
        word_count=EXCLUDED.word_count, source_artifact_id=EXCLUDED.source_artifact_id,
        updated_at=now()
    `;
    await tx`UPDATE document SET content_hash=${textHash}, source_artifact_id=${artifact.id},
      extraction_confidence=0.980, updated_at=now() WHERE id=${match.document_id}`;
    await tx`UPDATE judicial_opinion SET source_download_url=${item.document_url},
      source_artifact_id=${artifact.id}, updated_at=now() WHERE document_id=${match.document_id}`;
    await tx`
      INSERT INTO opinion_search_projection (
        document_id, case_id, court_id, cluster_id, title, case_caption, court_name,
        date_filed, precedential_status, opinion_type, citation_count, body
      ) VALUES (
        ${match.document_id}, ${match.case_id}, ${match.court_id}, ${match.cluster_id},
        ${match.title ?? `${match.caption} opinion`}, ${match.caption}, ${match.court_name},
        ${match.decided_on}, ${match.precedential_status}, ${match.opinion_type ?? "majority"},
        ${match.citation_count ?? 0}, ${validation.normalized}
      )
      ON CONFLICT (document_id) DO UPDATE SET body=EXCLUDED.body,
        title=EXCLUDED.title, case_caption=EXCLUDED.case_caption,
        date_filed=EXCLUDED.date_filed, updated_at=now()
    `;
    await tx`UPDATE appellate_ingestion_item SET source_artifact_id=${artifact.id},
      document_content_hash=${pdfHash}, state='published', blocker_code=NULL,
      blocker_detail=NULL, next_action=NULL, published_case_id=${match.case_id},
      last_seen_at=now() WHERE id=${item.id}`;
    await tx`
      INSERT INTO outbox_event (
        topic, aggregate_type, aggregate_id, aggregate_version, payload
      ) VALUES (
        'publication.changed', 'legal_case', ${match.case_id},
        (extract(epoch from clock_timestamp()) * 1000000)::bigint,
        ${tx.json({ source: "official_appellate", courtCode: item.court_code,
          docketNumber: item.docket_number, sourceHash: pdfHash,
          extractionMethod: "native_pdf_text", wordCount: validation.wordCount })}
      )
    `;
  });
  return { state: "published", caseId: match.case_public_id, words: validation.wordCount };
}

async function processQueue() {
  const items = await sql<{
    id: string; court_code: string; docket_number: string | null; document_url: string;
  }[]>`
    SELECT id, court_code, docket_number, document_url
    FROM appellate_ingestion_item
    WHERE state IN ('discovered','downloaded','extracted','enriched','publication_ready')
    ORDER BY decided_on DESC NULLS LAST, first_seen_at
    LIMIT ${processLimit}
  `;
  let cursor = 0;
  const results: Array<Record<string, unknown>> = [];
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      if (!item) continue;
      await heartbeat("extract-publish", item.court_code, { itemId: item.id });
      try {
        results.push({ itemId: item.id, court: item.court_code, ...(await downloadAndExtract(item)) });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await sql`UPDATE appellate_ingestion_item SET
          stage_attempts=jsonb_set(stage_attempts,'{extract_publish}',
            to_jsonb(coalesce((stage_attempts->>'extract_publish')::int,0)+1)),
          blocker_code='transient_processing_failure', blocker_detail=${message},
          next_action='Retry automatically with backoff' WHERE id=${item.id}`;
        results.push({ itemId: item.id, court: item.court_code, state: "retry", error: message });
      }
    }
  });
  await Promise.all(workers);
  return results;
}

async function cycle() {
  const checkpointRows = await sql<{ court_code: string; checkpoint: string | null }[]>`
    SELECT court_code, checkpoint FROM appellate_source_registry
  `;
  const order = courtArgument === "all"
    ? fairAppellateOrder(new Map(checkpointRows.map((row) => [row.court_code, row.checkpoint])))
    : [appellateCourtByCode(courtArgument)].filter((court) => court !== null);
  if (order.length === 0) throw new Error(`Unknown appellate court ${courtArgument}`);

  const discovery: Array<Record<string, unknown>> = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, order.length) }, async () => {
    while (cursor < order.length) {
      const court = order[cursor++];
      if (!court) continue;
      await heartbeat("discover", court.code, { remaining: order.length - cursor });
      try {
        discovery.push(await discoverOfficialAppellateOpinions(sql, court));
      } catch (error) {
        discovery.push({ court: court.code, error: error instanceof Error ? error.message : String(error) });
      }
    }
  });
  await Promise.all(workers);
  const processed = await processQueue();

  const [health] = await sql<{
    stalled_workers: number; blocked: number; oldest_minutes: number | null;
  }[]>`
    SELECT
      (SELECT count(*)::int FROM appellate_worker_heartbeat
        WHERE heartbeat_at < now() - interval '10 minutes') AS stalled_workers,
      (SELECT count(*)::int FROM appellate_ingestion_item WHERE state='blocked') AS blocked,
      (SELECT extract(epoch FROM (now()-min(first_seen_at)))/60
        FROM appellate_ingestion_item
        WHERE state IN ('discovered','downloaded','extracted','enriched','publication_ready'))
        AS oldest_minutes
  `;
  await heartbeat("idle", null, { discovery, processed, health });
  console.log(JSON.stringify({
    lane: "official-appellate",
    historicalOrder: "newest-to-oldest",
    configuredCircuits: APPELLATE_COURT_REGISTRY.length,
    discovery, processed, health,
  }));
}

try {
  do {
    await cycle();
    if (watch) await sleep(intervalMs);
  } while (watch);
} finally {
  await closeDb();
}
