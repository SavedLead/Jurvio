import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/config/site-url";
import { sitePubliclyLaunched } from "@/lib/seo/indexing";

export const dynamic = "force-dynamic";

const PUBLIC_ROUTES = [
  "/",
  "/cases",
  "/parties",
  "/judges",
  "/courts",
  "/supreme-court",
  "/explainers",
  "/government-litigation",
  "/coverage",
  "/methodology",
  "/editorial-standards",
  "/public-records-policy",
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  if (!sitePubliclyLaunched()) return [];

  const origin = siteOrigin();
  const lastModified = new Date();

  return PUBLIC_ROUTES.map((path) => ({
    url: new URL(path, origin).toString(),
    lastModified,
    changeFrequency: path === "/" ? "daily" : "weekly",
    priority: path === "/" ? 1 : path === "/cases" ? 0.9 : 0.7,
  }));
}
