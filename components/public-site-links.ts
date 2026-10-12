import type { Viewport } from "next";

/* Shared wiring for the public site (the landing page and the legal
   pages): where the repo lives, the header nav, the footer directory, and
   the viewport each public page exports so the browser chrome matches the
   site background. */

export const GITHUB_URL = "https://github.com/xbirimensah/opensetter";

export const githubIconPath =
  "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z";

export interface SiteLink {
  label: string;
  href: string;
}

/* The public site is one page; the nav jumps to its sections. Absolute
   ("/#...") so the same links work from the legal pages. */
export const SITE_NAV: ReadonlyArray<SiteLink> = [
  { label: "How it works", href: "/#how" },
  { label: "AI setter", href: "/#ai-setter" },
  { label: "Templates", href: "/#templates" },
  { label: "Agencies", href: "/#agencies" },
  { label: "Security", href: "/#security" },
];

export const SITE_FOOTER_GROUPS: ReadonlyArray<{ title: string; links: ReadonlyArray<SiteLink> }> = [
  {
    title: "Product",
    links: [
      { label: "How it works", href: "/#how" },
      { label: "Flows", href: "/#flows" },
      { label: "Inbox", href: "/#inbox" },
      { label: "AI setter", href: "/#ai-setter" },
    ],
  },
  {
    title: "Use it",
    links: [
      { label: "Templates", href: "/#templates" },
      { label: "Agencies", href: "/#agencies" },
      { label: "Security", href: "/#security" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
      { label: "Data deletion", href: "/data-deletion" },
      { label: "Meta App Review", href: "/meta-review" },
    ],
  },
];

/* Matches --color-background in the [data-theme="site"] block of
   app/globals.css. One value for both schemes: the public site is always
   dark, so a light-mode phone should not get a light status bar. */
export const SITE_BACKGROUND = "#050505";

export const siteViewport: Viewport = {
  themeColor: SITE_BACKGROUND,
  colorScheme: "dark",
};
