import Link from "next/link";
import { GitHubMark } from "@/components/public-site-icons";
import { GITHUB_URL, SITE_FOOTER_GROUPS } from "@/components/public-site-links";

/* Directory footer: every public page one tap away, for wayfinding and
   internal links. */
export default function PublicSiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-container grid gap-10 py-14 sm:py-16 lg:grid-cols-[1.2fr_2fr]">
        <div>
          <Link href="/" className="site-wordmark" aria-label="OpenSetter home">
            OpenSetter
          </Link>
          <p className="mt-3 max-w-xs text-sm leading-6 text-muted">
            Open source Instagram comment-to-DM automation with an AI setter.
          </p>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="site-footer-link mt-4 gap-2"
          >
            <GitHubMark />
            View on GitHub
          </a>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3">
          {SITE_FOOTER_GROUPS.map((group) => (
            <nav key={group.title} aria-label={group.title}>
              <h2 className="site-label">{group.title}</h2>
              <ul className="mt-3">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="site-footer-link">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      </div>
    </footer>
  );
}
