function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Removes subject names and contact addresses from a public log line. */
export function scrubRedactionLog(text: string, secrets: readonly string[]): string {
  const tokens = new Set<string>();
  for (const secret of secrets) {
    const trimmed = secret.trim();
    if (trimmed.length >= 3) tokens.add(trimmed);
    for (const part of trimmed.split(/\s+/)) {
      if (part.length >= 3) tokens.add(part);
    }
  }
  let out = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted]");
  for (const token of [...tokens].sort((left, right) => right.length - left.length)) {
    out = out.replace(new RegExp(escapeRegExp(token), "gi"), "[redacted]");
  }
  return out;
}
