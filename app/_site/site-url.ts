/* Public origin for absolute URLs (sitemap, robots). NEXTAUTH_URL is
   already required to be the public https URL in production. */
export function siteUrl(): string {
  return (process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}
