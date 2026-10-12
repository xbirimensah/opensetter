"use client";

import Link from "next/link";
import { useRef } from "react";
import { GITHUB_URL, SITE_NAV } from "@/components/public-site-links";

const MENU_ID = "site-menu";

/* Small-screen navigation. Built on the native popover API, so light
   dismiss (tap outside, Escape) and the expanded state for assistive tech
   come from the browser. The only script is closing it when a link is
   chosen, which matters for same-page anchors like /#templates. */
export default function PublicSiteMenu() {
  const menuRef = useRef<HTMLDivElement>(null);
  const close = () => menuRef.current?.hidePopover();

  return (
    <>
      <button
        type="button"
        popoverTarget={MENU_ID}
        className="site-menu-button lg:hidden"
        aria-label="Menu"
      >
        <span aria-hidden="true" className="site-menu-icon" />
      </button>

      <div id={MENU_ID} ref={menuRef} popover="auto" className="site-menu">
        <nav aria-label="Site">
          <ul>
            {SITE_NAV.map((link) => (
              <li key={link.href}>
                <Link href={link.href} onClick={close} className="site-menu-link">
                  {link.label}
                </Link>
              </li>
            ))}
            <li>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer"
                onClick={close}
                className="site-menu-link"
              >
                GitHub
              </a>
            </li>
          </ul>
        </nav>
        <Link href="/login" onClick={close} className="site-btn site-btn-secondary site-btn-block">
          Sign in
        </Link>
      </div>
    </>
  );
}
