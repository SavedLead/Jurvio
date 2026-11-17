/**
 * Downloads the public Supreme Court case JSON and the filing PDFs it links.
 * Constants are initialized before any fetch. Compare mode awaits this while
 * the script is still starting, so a const declared later would throw
 * "before initialization" and look like a network block.
 */
import { acceptFilingExcerpt, inspectCaseJson, officialCaseJsonUrl, type FilingExcerpt } from "@/modules/scotus/domain/emergency-brief";
import { textFromPdfBytes } from "@/modules/scotus/domain/filing-pdf-text";

const COURT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const REQUEST_GAP_MS = 1_200;
const MAX_PDF_BYTES = 6_000_000;

export interface FilingFetch {
  filings: FilingExcerpt[];
  skipped: Array<{ role: string; url: string; reason: string }>;
  note: string | null;
  jsonUrl: string | null;
  httpStatus: number | null;
  bytes: number;
  contentType: string | null;
  rawLinks: number;
  keptLinks: number;
  pdfs: Array<{ role: string; url: string; httpStatus: number | null; bytes: number }>;
  /** True only after a real HTTP response that is not the case JSON, or a network failure. */
  blocked: boolean;
}

export interface FilingFetchOptions {
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  gapMs?: number;
  now?: () => number;
}

let lastCourtRequest = 0;

function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "AbortError" || /fetch failed|network|ECONN|ENOTFOUND|ETIMEDOUT|aborted|socket/i.test(error.message);
}

async function courtFetch(url: string, accept: string, options: { fetch: NonNullable<FilingFetchOptions["fetch"]>; gapMs: number; now: () => number }): Promise<Response> {
  const wait = options.gapMs - (options.now() - lastCourtRequest);
  if (lastCourtRequest && wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastCourtRequest = options.now();
  return options.fetch(url, {
    headers: { "user-agent": COURT_USER_AGENT, accept, "accept-language": "en-US,en;q=0.9" },
    redirect: "follow",
    signal: AbortSignal.timeout(45_000),
  });
}

function skipFiling(docketNumber: string, role: string, url: string, reason: string) {
  console.log(JSON.stringify({ docket: docketNumber, filing: role, skipped: reason, stored: false }));
  return { role, url, reason };
}

export async function loadFilingExcerpts(docketNumber: string, options: FilingFetchOptions = {}): Promise<FilingFetch> {
  const fetchImpl = options.fetch ?? fetch;
  const gapMs = options.gapMs ?? REQUEST_GAP_MS;
  const now = options.now ?? Date.now;
  const call = { fetch: fetchImpl, gapMs, now };
  const empty: FilingFetch = {
    filings: [],
    skipped: [],
    note: null,
    jsonUrl: officialCaseJsonUrl(docketNumber),
    httpStatus: null,
    bytes: 0,
    contentType: null,
    rawLinks: 0,
    keptLinks: 0,
    pdfs: [],
    blocked: false,
  };
  if (!empty.jsonUrl) return { ...empty, note: "Docket number has no case JSON URL." };
  const jsonUrl = empty.jsonUrl;
  let payload: unknown;
  try {
    const response = await courtFetch(jsonUrl, "application/json,text/plain,*/*", call);
    const bytes = new Uint8Array(await response.arrayBuffer());
    empty.httpStatus = response.status;
    empty.bytes = bytes.byteLength;
    empty.contentType = response.headers.get("content-type");
    const host = new URL(response.url || jsonUrl).hostname;
    const jsonBody = /json/i.test(empty.contentType ?? "");
    if (!response.ok || host !== "www.supremecourt.gov" || !jsonBody) {
      empty.blocked = true;
      empty.note = `Case JSON HTTP ${response.status} from ${host}, ${bytes.byteLength} bytes, ${empty.contentType ?? "no content type"}.`;
      return empty;
    }
    try {
      payload = JSON.parse(new TextDecoder().decode(bytes));
    } catch (error) {
      empty.note = error instanceof Error ? error.message : "Case JSON did not parse.";
      return empty;
    }
  } catch (error) {
    empty.blocked = isNetworkError(error);
    empty.note = error instanceof Error ? error.message : "Case JSON fetch failed.";
    return empty;
  }
  const inspected = inspectCaseJson(payload);
  empty.rawLinks = inspected.rawLinks;
  empty.keptLinks = inspected.kept.length;
  for (const link of inspected.kept) {
    try {
      const response = await courtFetch(link.url, "application/pdf,*/*", call);
      const bytes = new Uint8Array(await response.arrayBuffer());
      empty.pdfs.push({ role: link.role, url: link.url, httpStatus: response.status, bytes: bytes.byteLength });
      if (!response.ok || new URL(response.url || link.url).hostname !== "www.supremecourt.gov") {
        empty.skipped.push(skipFiling(docketNumber, link.role, link.url, `HTTP ${response.status}`));
        continue;
      }
      if (bytes.byteLength > MAX_PDF_BYTES) {
        empty.skipped.push(skipFiling(docketNumber, link.role, link.url, "larger than 6 MB"));
        continue;
      }
      const extracted = await textFromPdfBytes(bytes);
      if (!extracted) {
        empty.skipped.push(skipFiling(docketNumber, link.role, link.url, "unreadable PDF"));
        continue;
      }
      const excerpt = acceptFilingExcerpt(extracted, link.role, link.url);
      if (excerpt.withheld || !excerpt.text) {
        empty.skipped.push(skipFiling(docketNumber, link.role, link.url, excerpt.withheld ? "sealed or restricted text" : "empty extract"));
        continue;
      }
      empty.filings.push(excerpt);
    } catch (error) {
      empty.pdfs.push({ role: link.role, url: link.url, httpStatus: null, bytes: 0 });
      if (isNetworkError(error)) empty.blocked = true;
      empty.skipped.push(skipFiling(docketNumber, link.role, link.url, error instanceof Error ? error.message : "PDF failed"));
    }
  }
  empty.note = inspected.kept.length ? null : "The case JSON listed no application, response, reply, or lower-court opinion PDF.";
  return empty;
}
