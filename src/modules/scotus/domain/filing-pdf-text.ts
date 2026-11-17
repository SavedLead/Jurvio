/**
 * Text from a filing PDF. The text layer uses unpdf. A scan with no text layer
 * is rasterized with @napi-rs/canvas (a prebuilt binary, no apt) and read with
 * tesseract.js (wasm). A missing or unreadable file returns null.
 */
import { extractText, getDocumentProxy, renderPageAsImage } from "unpdf";

export const OCR_PAGE_CAP = 6;

export function needsOcr(text: string, pages: number): boolean {
  if (pages < 1) return false;
  return text.replace(/\s+/g, " ").trim().length < 15;
}

export interface PdfText {
  text: string;
  ocrPages: number;
}

export async function textFromPdfBytes(bytes: Uint8Array): Promise<PdfText | null> {
  if (bytes.byteLength < 5) return null;
  try {
    const result = await extractText(bytes, { mergePages: true });
    const raw = Array.isArray(result.text) ? result.text.join("\n") : result.text;
    const layered = raw.replace(/\s+/g, " ").trim();
    const pages = result.totalPages ?? 0;
    if (!needsOcr(layered, pages)) return { text: layered, ocrPages: 0 };
    try {
      const ocr = await ocrFirstPages(bytes, pages);
      if (ocr.text.length) {
        console.log(JSON.stringify({ ocrPages: ocr.ocrPages, chars: ocr.text.length, stored: false }));
        return ocr;
      }
    } catch (error) {
      console.log(JSON.stringify({ ocrPages: 0, chars: layered.length, skipped: error instanceof Error ? error.message : "ocr failed", stored: false }));
    }
    return layered.length ? { text: layered, ocrPages: 0 } : null;
  } catch {
    return null;
  }
}

async function ocrFirstPages(bytes: Uint8Array, pages: number): Promise<PdfText> {
  const limit = Math.min(Math.max(pages, 1), OCR_PAGE_CAP);
  const { createWorker } = await import("tesseract.js");
  const doc = await getDocumentProxy(bytes);
  const worker = await createWorker("eng");
  try {
    const parts: string[] = [];
    for (let page = 1; page <= limit; page += 1) {
      const png = await renderPageAsImage(doc, page, {
        canvasImport: () => import("@napi-rs/canvas"),
        scale: 1.5,
      });
      const { data } = await worker.recognize(Buffer.from(png));
      if (data.text.trim()) parts.push(data.text);
    }
    return { text: parts.join("\n").replace(/\s+/g, " ").trim(), ocrPages: limit };
  } finally {
    await worker.terminate();
  }
}
