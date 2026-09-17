import { createSign } from "node:crypto";

const serviceAccountRaw = process.env.GOOGLE_SEARCH_CONSOLE_SERVICE_ACCOUNT_JSON?.trim();
const siteUrl = process.env.GSC_SITE_URL?.trim() || "sc-domain:jurvio.com";
const sitemapUrl = process.env.GSC_SITEMAP_URL?.trim() || "https://jurvio.com/sitemap.xml";
const inspectionUrls = (process.env.GSC_INSPECTION_URLS || "https://jurvio.com/,https://jurvio.com/cases,https://jurvio.com/coverage")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

async function accessToken(credentials) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/webmasters",
    aud: credentials.token_uri || "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${signer.sign(credentials.private_key, "base64url")}`;
  const response = await fetch(credentials.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) throw new Error(`Google OAuth failed: ${response.status} ${await response.text()}`);
  return (await response.json()).access_token;
}

async function google(token, url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) throw new Error(`Google API failed: ${response.status} ${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

if (!serviceAccountRaw) {
  console.log("Search Console connection is not configured yet; add GOOGLE_SEARCH_CONSOLE_SERVICE_ACCOUNT_JSON.");
  process.exit(0);
}

const robots = await fetch("https://jurvio.com/robots.txt");
const robotsText = robots.ok ? await robots.text() : "";
if (!robots.ok || /Disallow:\s*\/\s*$/im.test(robotsText)) {
  console.log("Jurvio is still pre-launch/noindex; Search Console sitemap submission skipped safely.");
  process.exit(0);
}

const credentials = JSON.parse(serviceAccountRaw);
if (!credentials.client_email || !credentials.private_key) {
  throw new Error("Search Console service-account JSON is missing client_email or private_key.");
}
const token = await accessToken(credentials);
const encodedSite = encodeURIComponent(siteUrl);
const encodedSitemap = encodeURIComponent(sitemapUrl);

await google(token, `https://www.googleapis.com/webmasters/v3/sites/${encodedSite}/sitemaps/${encodedSitemap}`, { method: "PUT" });
const sitemap = await google(token, `https://www.googleapis.com/webmasters/v3/sites/${encodedSite}/sitemaps/${encodedSitemap}`);

const inspections = [];
for (const inspectionUrl of inspectionUrls) {
  const result = await google(token, "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
    method: "POST",
    body: JSON.stringify({ inspectionUrl, siteUrl }),
  });
  const status = result?.inspectionResult?.indexStatusResult;
  inspections.push({
    url: inspectionUrl,
    verdict: status?.verdict ?? null,
    coverageState: status?.coverageState ?? null,
    lastCrawlTime: status?.lastCrawlTime ?? null,
    robotsTxtState: status?.robotsTxtState ?? null,
    indexingState: status?.indexingState ?? null,
  });
}

console.log(JSON.stringify({
  connectedAs: credentials.client_email,
  siteUrl,
  sitemap: {
    path: sitemap?.path ?? sitemapUrl,
    lastSubmitted: sitemap?.lastSubmitted ?? null,
    lastDownloaded: sitemap?.lastDownloaded ?? null,
    pending: sitemap?.isPending ?? null,
    warnings: sitemap?.warnings ?? null,
    errors: sitemap?.errors ?? null,
  },
  inspections,
}, null, 2));
