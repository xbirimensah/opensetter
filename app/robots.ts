import type { MetadataRoute } from "next";
import { siteUrl } from "@/app/_site/site-url";

/* Crawl the public pages only. Tracked-link redirects (/r, /f) are kept out
   so crawlers never count as clicks, and shared client reports stay
   private (they also send noindex). */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/r/", "/f/", "/reports/", "/invite", "/verify-request"],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
