/* Shared wiring for the public site: where the repo lives, the app the
   CTAs open, and the nav and footer directories. */

/** Origin of the Next.js app (login, legal pages). Empty = same origin. */
export const APP_URL = (import.meta.env.PUBLIC_APP_URL ?? "").replace(/\/$/, "");

export const GITHUB_URL = "https://github.com/xbirimensah/opensetter";

export const appHref = (path: string) => `${APP_URL}${path}`;

export interface SiteLink {
  label: string;
  href: string;
}

export const SITE_NAV: ReadonlyArray<SiteLink> = [
  { label: "How it works", href: "#how" },
  { label: "Flows", href: "#flows" },
  { label: "AI setter", href: "#ai-setter" },
  { label: "Templates", href: "#templates" },
  { label: "Security", href: "#security" },
];

export const FOOTER_GROUPS: ReadonlyArray<{ title: string; links: ReadonlyArray<SiteLink> }> = [
  {
    title: "Product",
    links: [
      { label: "How it works", href: "#how" },
      { label: "Flows", href: "#flows" },
      { label: "Inbox", href: "#inbox" },
      { label: "AI setter", href: "#ai-setter" },
    ],
  },
  {
    title: "Use it",
    links: [
      { label: "Templates", href: "#templates" },
      { label: "Agencies", href: "#agencies" },
      { label: "Security", href: "#security" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy", href: appHref("/privacy") },
      { label: "Terms", href: appHref("/terms") },
      { label: "Data deletion", href: appHref("/data-deletion") },
      { label: "Meta App Review", href: appHref("/meta-review") },
    ],
  },
];

export const BACKGROUND = "#050505";

export function formatStars(count: number): string {
  return count >= 1000 ? `${(count / 1000).toFixed(1)}K` : count.toLocaleString("en-US");
}

/** Star count at build time; the page renders fine without it. */
export async function getGitHubStars(): Promise<number | null> {
  try {
    const res = await fetch("https://api.github.com/repos/xbirimensah/opensetter", {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { stargazers_count?: number };
    return typeof data.stargazers_count === "number" ? data.stargazers_count : null;
  } catch (error) {
    console.warn("[site] GitHub stars unavailable:", error instanceof Error ? error.message : error);
    return null;
  }
}
