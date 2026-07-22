export function siteOrigin(): string {
  const url = new URL(process.env.SITE_URL ?? "https://jurvio.com");
  return url.origin;
}
