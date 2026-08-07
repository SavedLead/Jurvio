import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/config/site-url";
import { sitePubliclyLaunched } from "@/lib/seo/indexing";

export default function robots(): MetadataRoute.Robots {
  // Locked down until launch: disallow all crawling and advertise no sitemap.
  // This is the default whenever JURVIO_PUBLIC_LAUNCH is not "true".
  if (!sitePubliclyLaunched()) {
    return {
      rules: {
        userAgent: "*",
        disallow: "/",
      },
    };
  }

  // Launched: allow crawling of public pages, keep internal surfaces out, and
  // advertise the sitemap.
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/internal", "/in", "/preview", "/heartbeat"],
    },
    sitemap: `${siteOrigin()}/sitemap.xml`,
  };
}
