"use client";

/**
 * Mobile bottom navigation
 *
 * Thumb-reachable tabs for the screens used on the go. Everything else
 * stays one tap away in the drawer behind "More". Hidden from lg up,
 * where the sidebar is always visible.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { label: "Inbox", href: "/inbox" },
  { label: "AI Setter", href: "/ai-setter" },
  { label: "Campaigns", href: "/campaigns" },
  { label: "Flows", href: "/flows" },
  { label: "Dashboard", href: "/dashboard" },
];

interface MobileNavProps {
  onMoreClick: () => void;
}

export default function MobileNav({ onMoreClick }: MobileNavProps) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      {/* One column per tab plus "More". */}
      <ul className="grid grid-cols-6">
        {tabs.map((tab) => {
          const isActive =
            pathname === tab.href || pathname.startsWith(tab.href + "/");
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={isActive ? "page" : undefined}
                className={`flex min-h-14 items-center justify-center px-1 text-center text-xs leading-tight ${
                  isActive
                    ? "font-semibold text-accent"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            onClick={onMoreClick}
            className="flex min-h-14 w-full items-center justify-center px-1 text-xs text-muted hover:text-foreground"
          >
            More
          </button>
        </li>
      </ul>
    </nav>
  );
}
