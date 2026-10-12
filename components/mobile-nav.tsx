"use client";

/**
 * Mobile bottom navigation
 *
 * Thumb-reachable tabs for the screens used on the go. Everything else
 * stays one tap away in the drawer behind "More". Translucent chrome over
 * the content with a soft fade on its top edge (see .app-tabbar). Hidden
 * from lg up, where the sidebar is always visible.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import {
  AiSetterIcon,
  DashboardIcon,
  FlowsIcon,
  InboxIcon,
  MoreIcon,
} from "@/components/nav-icons";

type TabIcon = ComponentType<{ size?: number; className?: string }>;

const tabs: Array<{ label: string; href: string; icon: TabIcon; alsoActiveOn?: string[] }> = [
  { label: "Inbox", href: "/inbox", icon: InboxIcon },
  { label: "AI Setter", href: "/ai-setter", icon: AiSetterIcon },
  { label: "Flows", href: "/flows", icon: FlowsIcon, alsoActiveOn: ["/campaigns", "/automations"] },
  { label: "Dashboard", href: "/dashboard", icon: DashboardIcon },
];

function matches(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

interface MobileNavProps {
  onMoreClick: () => void;
  moreOpen: boolean;
}

const TAB_CLASS =
  "press flex min-h-[3.25rem] w-full flex-col items-center justify-center gap-0.5 px-1 text-[0.6875rem] leading-tight tracking-[0.01em]";

export default function MobileNav({ onMoreClick, moreOpen }: MobileNavProps) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="app-tabbar fixed inset-x-0 bottom-0 z-30 pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      {/* One column per tab plus "More". */}
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {tabs.map((tab) => {
          const isActive = [tab.href, ...(tab.alsoActiveOn ?? [])].some((prefix) =>
            matches(pathname, prefix)
          );
          const TabGlyph = tab.icon;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={isActive ? "page" : undefined}
                className={`${TAB_CLASS} ${
                  isActive ? "font-semibold text-accent" : "text-faint active:text-foreground"
                }`}
              >
                <TabGlyph size={22} />
                {tab.label}
              </Link>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            onClick={onMoreClick}
            aria-controls="app-sidebar"
            aria-expanded={moreOpen}
            className={`${TAB_CLASS} text-faint active:text-foreground`}
          >
            <MoreIcon size={22} />
            More
          </button>
        </li>
      </ul>
    </nav>
  );
}
