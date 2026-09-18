const token = process.env.GOOGLE_OAUTH_ACCESS_TOKEN?.trim();
const serviceAccount = process.env.GCP_SERVICE_ACCOUNT?.trim() || "jurvio-search-console@jurvio-search-console.iam.gserviceaccount.com";
const siteUrl = process.env.GSC_SITE_URL?.trim() || "sc-domain:jurvio.com";
const sitemapUrl = process.env.GSC_SITEMAP_URL?.trim() || "https://jurvio.com/sitemap.xml";
const inspectionUrls = (process.env.GSC_INSPECTION_URLS || "https://jurvio.com/,https://jurvio.com/cases,https://jurvio.com/coverage")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

async function google(url, init = {}) {
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

async function fetchXml(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Sitemap fetch failed: ${response.status} ${url}`);
  return response.text();
}

async function countSitemapUrls(indexUrl) {
  const indexXml = await fetchXml(indexUrl);
  const childUrls = [...indexXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) =>
    match[1].replaceAll("&amp;", "&"),
  );
  if (!/<sitemapindex\b/.test(indexXml)) {
    return { childSitemaps: 0, urls: (indexXml.match(/<url>/g) || []).length };
  }

  let urls = 0;
  for (let offset = 0; offset < childUrls.length; offset += 10) {
    const batch = childUrls.slice(offset, offset + 10);
    const children = await Promise.all(batch.map(fetchXml));
    urls += children.reduce((total, xml) => total + (xml.match(/<url>/g) || []).length, 0);
  }
  return { childSitemaps: childUrls.length, urls };
}

if (!token) {
  throw new Error("Google Workload Identity authentication did not provide an access token.");
}

const sites = await google("https://www.googleapis.com/webmasters/v3/sites");
const property = sites?.siteEntry?.find((entry) => entry.siteUrl === siteUrl);
if (!property) {
  throw new Error(`The service account cannot access ${siteUrl}. Add ${serviceAccount} as a Full user in Search Console.`);
}

console.log(`Search Console connection verified for ${siteUrl} as ${serviceAccount} (${property.permissionLevel}).`);

const robots = await fetch("https://jurvio.com/robots.txt");
const robotsText = robots.ok ? await robots.text() : "";
if (!robots.ok || /Disallow:\s*\/\s*$/im.test(robotsText)) {
  console.log("Jurvio is still pre-launch/noindex; sitemap submission and URL inspection skipped safely.");
  process.exit(0);
}

const sitemapCount = await countSitemapUrls(sitemapUrl);
const encodedSite = encodeURIComponent(siteUrl);
const encodedSitemap = encodeURIComponent(sitemapUrl);

await google(`https://www.googleapis.com/webmasters/v3/sites/${encodedSite}/sitemaps/${encodedSitemap}`, { method: "PUT" });
const sitemap = await google(`https://www.googleapis.com/webmasters/v3/sites/${encodedSite}/sitemaps/${encodedSitemap}`);

const inspections = [];
for (const inspectionUrl of inspectionUrls) {
  const result = await google("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
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
  connectedAs: serviceAccount,
  siteUrl,
  sitemap: {
    path: sitemap?.path ?? sitemapUrl,
    childSitemaps: sitemapCount.childSitemaps,
    submittedUrls: sitemapCount.urls,
    lastSubmitted: sitemap?.lastSubmitted ?? null,
    lastDownloaded: sitemap?.lastDownloaded ?? null,
    pending: sitemap?.isPending ?? null,
    warnings: sitemap?.warnings ?? null,
    errors: sitemap?.errors ?? null,
  },
  inspections,
}, null, 2));
