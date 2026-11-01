import { emailConfigured, getEmailProvider, isProduction } from "../infrastructure/email";

export function siteUrl(): string {
  return process.env.SITE_URL?.trim() || "https://jurvio.com";
}

/** Production without an email provider cannot sign anyone in. */
export function signInAvailable(): boolean {
  return emailConfigured() || !isProduction();
}

export function signInDeps() {
  return { provider: getEmailProvider(), siteUrl: siteUrl(), production: isProduction() };
}

/** Absolute URL for redirects: the public site in production, the request origin in dev/test. */
export function absoluteUrl(path: string, requestOrigin: string): URL {
  return new URL(path, isProduction() ? siteUrl() : requestOrigin);
}
