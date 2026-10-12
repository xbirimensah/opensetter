import type { MetadataRoute } from "next";
import { siteUrl } from "@/app/_site/site-url";

/* The public site is the landing page plus the legal pages Meta requires.
   Everything else is the signed-in app or a retired route that redirects. */
const PUBLIC_PATHS = ["/", "/privacy", "/terms", "/data-deletion", "/meta-review"];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return PUBLIC_PATHS.map((path) => ({
    url: `${base}${path}`,
    changeFrequency: path === "/" ? "weekly" : "yearly",
    priority: path === "/" ? 1 : 0.3,
  }));
}
