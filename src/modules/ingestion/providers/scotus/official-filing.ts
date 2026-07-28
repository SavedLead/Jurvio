import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_PDF_BYTES = 40 * 1024 * 1024;

export interface OfficialFilingPdf { body: Uint8Array; contentHash: string; retrievedAt: string; sourceUri: string; }

export async function fetchOfficialFilingPdf(sourceUri: string): Promise<OfficialFilingPdf> {
  const url = new URL(sourceUri);
  if (url.origin !== "https://www.supremecourt.gov" || !url.pathname.toLowerCase().endsWith(".pdf")) throw new Error("Filing is not an official Supreme Court PDF");
  const response = await fetch(url, { headers: { "user-agent": process.env.INGESTION_USER_AGENT ?? "Jurvio/0.1" }, redirect: "error" });
  if (!response.ok) throw new Error(`Supreme Court filing returned HTTP ${response.status}`);
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > MAX_PDF_BYTES) throw new Error("Supreme Court filing exceeds byte cap");
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength > MAX_PDF_BYTES || body[0] !== 0x25 || body[1] !== 0x50 || body[2] !== 0x44 || body[3] !== 0x46) throw new Error("Official filing response is not a bounded PDF");
  return { body, sourceUri: url.toString(), contentHash: createHash("sha256").update(body).digest("hex"), retrievedAt: new Date().toISOString() };
}

export function extractQuestionPresented(text: string): string | null {
  const normalized = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const match = /(?:^|\n)\s*(?:QUESTIONS? PRESENTED|QUESTION PRESENTED FOR REVIEW)\s*\n([\s\S]*?)(?=\n\s*(?:RELATED PROCEEDINGS|PARTIES TO THE PROCEEDING|TABLE OF CONTENTS|LIST OF PARTIES|CORPORATE DISCLOSURE|OPINIONS BELOW|JURISDICTION|CONSTITUTIONAL AND STATUTORY PROVISIONS)\s*(?:\n|$))/im.exec(normalized);
  if (!match) return null;
  const question = (match[1] ?? "").replaceAll(/\s+/g, " ").replace(/^\d+\.\s*/, "").trim();
  if (question.length < 20 || question.length > 8_000) return null;
  return question;
}

export async function extractQuestionPresentedFromPdf(pdf: Uint8Array) {
  const directory = await mkdtemp(path.join(tmpdir(), "jurvio-question-"));
  try {
    const pdfPath = path.join(directory, "petition.pdf");
    const textPath = path.join(directory, "petition.txt");
    await writeFile(pdfPath, pdf);
    await execFileAsync("pdftotext", ["-layout", pdfPath, textPath], { timeout: 60_000, maxBuffer: 2 * 1024 * 1024 });
    return extractQuestionPresented(await readFile(textPath, "utf8"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
