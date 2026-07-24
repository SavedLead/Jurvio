import { siteOrigin } from "@/lib/config/site-url";
import { explainerGlossary, legalExplainers } from "@/modules/explainers/domain/explainers";

export function GET() {
  const origin = siteOrigin();
  const glossary = explainerGlossary().map((entry) => {
    const source = legalExplainers.find((item) => item.slug === entry.slug);
    return {
      ...entry,
      canonicalUrl: `${origin}/explainers/${entry.slug}`,
      sources: source?.sources ?? [],
    };
  });

  return Response.json({
    schemaVersion: "jurvio.legal-glossary.v1",
    canonicalUrl: `${origin}/explainers`,
    contentType: "general_legal_education",
    legalAdvice: false,
    reviewedOn: "2026-07-23",
    entries: glossary,
  }, {
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800",
      "X-Robots-Tag": "index, follow",
    },
  });
}
