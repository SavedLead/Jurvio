import { siteOrigin } from "@/lib/config/site-url";

export function GET() {
  const origin = siteOrigin();
  return new Response(`User-agent: *\nAllow: /\nDisallow: /internal/\n\nSitemap: ${origin}/sitemap.xml\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
