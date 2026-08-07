import { siteOrigin } from "@/lib/config/site-url";
import { sitePubliclyLaunched } from "@/lib/seo/indexing";
import { getExplainer } from "@/modules/explainers/domain/explainers";

export function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return params.then(({ slug }) => {
    const item = getExplainer(slug);
    if (!item) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({
      schemaVersion: "jurvio.explainer.v1", canonicalUrl: `${siteOrigin()}/explainers/${item.slug}`,
      contentType: "general_legal_education", legalAdvice: false, neutralCommentary: true,
      explainer: item,
    }, { headers: { "Cache-Control": "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800", "X-Robots-Tag": sitePubliclyLaunched() ? "index, follow" : "noindex, nofollow, noarchive, nosnippet, noimageindex" } });
  });
}
