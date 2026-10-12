import Link from "next/link";
import PublicSiteMenu from "@/components/public-site-menu";
import { GitHubMark } from "@/components/public-site-icons";
import { GITHUB_URL, SITE_NAV } from "@/components/public-site-links";

interface PublicSiteHeaderProps {
  /* GitHub star count; only the landing page fetches it. */
  stars?: number | null;
}

export function formatStars(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return count.toLocaleString();
}

/* Translucent sticky bar: content scrolls under the material, and a soft
   scroll-edge fade replaces a hard divider (see .site-header in
   globals.css). */
export default function PublicSiteHeader({
  stars = null,
}: PublicSiteHeaderProps) {
  return (
    <header className="site-header">
      <div className="site-container flex h-full items-center gap-8">
        <Link href="/" className="site-wordmark" aria-label="OpenSetter home">
          OpenSetter
        </Link>

        <nav aria-label="Main" className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {SITE_NAV.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="site-navlink">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="site-navlink hidden gap-2 sm:inline-flex"
            aria-label={
              stars !== null
                ? `OpenSetter on GitHub, ${formatStars(stars)} stars`
                : "OpenSetter on GitHub"
            }
          >
            <GitHubMark />
            {stars !== null && (
              <span className="tabular-nums" aria-hidden="true">
                {formatStars(stars)}
              </span>
            )}
          </a>
          <Link href="/login" className="site-navlink hidden lg:inline-flex">
            Sign in
          </Link>
          <PublicSiteMenu />
          <Link href="/login" className="site-btn site-btn-primary site-btn-sm ml-1">
            Get started
          </Link>
        </div>
      </div>
    </header>
  );
}
