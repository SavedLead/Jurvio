import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/config/site-url";
import { sitePubliclyLaunched } from "@/lib/seo/indexing";

// Rendered per request, not prerendered at build time. JURVIO_PUBLIC_LAUNCH is
// the single switch that opens the site for indexing, and it is set in the
// container's environment — a statically prerendered robots.txt would bake in
// whatever the flag was when the IMAGE was built, so flipping the flag on the
// box would leave the site advertising "Disallow: /" until the next rebuild.
export const dynamic = "force-dynamic";

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
  // advertise the sitemap. AionBot and MJ12bot are separate groups so they
  // are refused while Googlebot and Bingbot still match the * group.
  return {
    rules: [
      { userAgent: "AionBot", disallow: "/" },
      { userAgent: "MJ12bot", disallow: "/" },
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/internal", "/in", "/preview", "/heartbeat", "/publish-status"],
      },
    ],
    sitemap: `${siteOrigin()}/sitemap.xml`,
  };
}
