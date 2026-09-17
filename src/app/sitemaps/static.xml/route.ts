import { siteOrigin } from "@/lib/config/site-url";
import { xmlEscape, xmlResponse } from "@/modules/discovery/http/xml";
import { legalExplainers } from "@/modules/explainers/domain/explainers";

export function GET() {
  const origin = siteOrigin();
  const paths = [
    "/",
    "/cases",
    "/parties",
    "/judges",
    "/courts",
    "/law-firms",
    "/supreme-court",
    "/supreme-court/timeline",
    "/explainers",
    ...legalExplainers.map((item) => `/explainers/${item.slug}`),
    "/government-litigation",
    "/coverage",
    "/methodology",
    "/editorial-standards",
    "/public-records-policy",
    "/privacy",
    "/terms",
    "/contact",
    "/corrections",
  ];
  const urls = paths.map((path) => `<url><loc>${xmlEscape(origin + path)}</loc></url>`).join("");
  return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
}
