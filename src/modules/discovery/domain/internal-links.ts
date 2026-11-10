/**
 * Internal links a public page is allowed to render. A path that is not one of
 * these shapes, or an opinion path whose ids are malformed, is a link we must
 * not print: the opinion reader 404s on a bad id, and a crawl of the hub fails
 * the build when any internal href would.
 */
const APP_PATH = /^\/(?!\/)[^?#\s]*$/;

export function internalAppPaths(markup: string): string[] {
  const paths = new Set<string>();
  for (const match of markup.matchAll(/href="([^"]+)"/g)) {
    const raw = match[1] ?? "";
    const absolute = /^https?:\/\/(?:www\.)?jurvio\.com(\/[^"#?]*)/i.exec(raw);
    const path = absolute?.[1] ?? (raw.startsWith("/") && !raw.startsWith("//") ? raw.split(/[?#]/)[0] ?? "" : "");
    if (path && APP_PATH.test(path)) paths.add(path);
  }
  return [...paths];
}

/** Opinion document paths with ids the reader accepts. Other internal paths pass through. */
export function opinionPathWould404(path: string): boolean {
  const match = /^\/case\/(jv-[a-z0-9]{8,10})\/documents\/([^/]+)$/.exec(path);
  if (!match) return false;
  return !/^jd-[a-z0-9]{8,10}$/.test(match[2] ?? "");
}
