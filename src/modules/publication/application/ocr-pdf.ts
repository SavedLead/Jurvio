import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Optical character recognition for image-only PDFs -- the scanned opinions that
 * carry no text layer, so native `pdftotext` returns nothing and they end up
 * parked as "ocr_required". The pipeline is fully local and free: `pdftoppm`
 * (poppler) rasterizes each requested page to a PNG, then `tesseract` reads the
 * text off it. It is CPU-bound, so callers rasterize a bounded page window and a
 * bounded page count, and drain the backlog on a rate-limited lane rather than
 * inline on the hot ingestion path.
 */

export interface OcrOptions {
  // 1-based inclusive PDF page window. Omit to OCR from the first page.
  firstPage?: number;
  lastPage?: number;
  // Hard cap on how many pages to OCR, so one pathological document cannot pin a
  // core doing thousands of pages. Pages beyond the cap are skipped.
  maxPages?: number;
  // Rasterization resolution. 300 DPI is the accuracy/speed sweet spot for OCR.
  dpi?: number;
  // Per-page tesseract timeout (ms).
  perPageTimeoutMs?: number;
}

function pageIndexOf(fileName: string): number {
  // pdftoppm names pages "<prefix>-<n>.png" (zero-padded). Sort by the number.
  const match = /-(\d+)\.png$/.exec(fileName);
  return match ? Number.parseInt(match[1] ?? "", 10) : Number.MAX_SAFE_INTEGER;
}

export async function ocrPdf(pdfPath: string, options: OcrOptions = {}): Promise<string> {
  const dpi = options.dpi ?? 300;
  const maxPages = options.maxPages ?? 60;
  const perPageTimeoutMs = options.perPageTimeoutMs ?? 60_000;
  const directory = await mkdtemp(path.join(tmpdir(), "jurvio-ocr-"));
  try {
    const rasterArgs = ["-png", "-r", String(dpi)];
    if (options.firstPage !== undefined) rasterArgs.push("-f", String(options.firstPage));
    if (options.lastPage !== undefined) rasterArgs.push("-l", String(options.lastPage));
    const prefix = path.join(directory, "page");
    // Rasterize the requested window. pdftoppm is fast relative to tesseract.
    await execFileAsync("pdftoppm", [...rasterArgs, pdfPath, prefix], {
      timeout: 180_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const images = (await readdir(directory))
      .filter((name) => name.endsWith(".png"))
      .sort((left, right) => pageIndexOf(left) - pageIndexOf(right))
      .slice(0, maxPages);
    const pages: string[] = [];
    for (const image of images) {
      // `tesseract <img> stdout` prints recognized text. --psm 1 = automatic page
      // segmentation with orientation detection, best for full opinion pages.
      const { stdout } = await execFileAsync(
        "tesseract",
        [path.join(directory, image), "stdout", "-l", "eng", "--psm", "1"],
        { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: perPageTimeoutMs },
      );
      pages.push(stdout);
    }
    // Join pages with a form feed so downstream page-aware logic still sees breaks.
    return pages.join("\f");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
