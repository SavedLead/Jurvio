import { siteOrigin } from "@/lib/config/site-url";
import { xmlEscape, xmlResponse } from "@/modules/discovery/http/xml";

export function GET() {
  const origin = siteOrigin();
  const urls = ["/", "/cases", "/search"].map((path) => `<url><loc>${xmlEscape(origin + path)}</loc></url>`).join("");
  return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
}
