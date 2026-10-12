"use client";

/**
 * Top Bar
 *
 * Wayfinding for every app screen: the page title (the page's h1), the
 * connected Instagram account, and the theme switch. It is translucent
 * chrome over the scroll container: clear at rest, material plus a soft
 * scroll-edge fade once content passes under it (see .app-topbar).
 */

import { usePathname } from "next/navigation";
import ThemeToggle from "@/components/theme-toggle";
import { SidebarIcon } from "@/components/nav-icons";

const pageTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/overview": "Overview",
  "/inbox": "Inbox",
  "/ai-setter": "AI Setter",
  "/campaigns/import": "Import Classic Campaigns",
  "/campaigns": "Flows",
  "/campaigns/new": "Flows",
  "/automations": "Flows",
  "/automations/new": "Flows",
  "/flows/new": "New Flow",
  "/logs": "DM Logs",
  "/settings": "Settings",
  "/diagnostics": "Diagnostics",
  "/flows": "Flows",
};

interface TopBarProps {
  onMenuClick: () => void;
  menuOpen: boolean;
  scrolled: boolean;
  instagramUsername: string | null;
  instagramAccountCount: number;
}

export default function TopBar({
  onMenuClick,
  menuOpen,
  scrolled,
  instagramUsername,
  instagramAccountCount,
}: TopBarProps) {
  const pathname = usePathname();
  const title =
    pageTitles[pathname] ??
    (pathname.startsWith("/campaigns/")
      ? "Comment Stats"
      : pathname.startsWith("/flows/")
        ? "Flow"
        : "Dashboard");

  return (
    <header
      className="app-topbar pt-[env(safe-area-inset-top)]"
      data-scrolled={scrolled ? "true" : "false"}
    >
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4 lg:h-16 lg:px-8">
        <div className="flex min-w-0 items-center gap-1">
          <button
            type="button"
            onClick={onMenuClick}
            aria-label="Open menu"
            aria-controls="app-sidebar"
            aria-expanded={menuOpen}
            className="press -ml-2.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground hover:bg-fill lg:hidden"
          >
            <SidebarIcon size={22} />
          </button>
          <h1 className="truncate text-[1.0625rem] font-semibold tracking-[-0.012em] text-foreground lg:text-xl lg:font-bold">
            {title}
          </h1>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {instagramAccountCount > 0 ? (
            <p
              className="hidden max-w-48 items-center gap-2 truncate text-footnote text-muted sm:flex"
              title="Connected Instagram account"
            >
              <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
              <span className="truncate">
                {instagramAccountCount > 1
                  ? `${instagramAccountCount} accounts`
                  : `@${instagramUsername}`}
              </span>
            </p>
          ) : (
            <a href="/api/instagram/connect" className="btn btn-primary btn-sm">
              <span>
                Connect<span className="hidden sm:inline"> Instagram</span>
              </span>
            </a>
          )}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
