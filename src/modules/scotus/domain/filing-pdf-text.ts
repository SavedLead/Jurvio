/**
 * Text from a filing PDF using unpdf (pdf.js in pure JavaScript). No system
 * packages. A missing or unreadable file returns null so the caller can skip it.
 */
import { extractText } from "unpdf";

export async function textFromPdfBytes(bytes: Uint8Array): Promise<string | null> {
  if (bytes.byteLength < 5) return null;
  try {
    const result = await extractText(bytes, { mergePages: true });
    const raw = Array.isArray(result.text) ? result.text.join("\n") : result.text;
    const text = raw.replace(/\s+/g, " ").trim();
    return text.length ? text : null;
  } catch {
    return null;
  }
}
