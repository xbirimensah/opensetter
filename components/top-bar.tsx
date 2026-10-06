"use client";

/**
 * Top Bar
 *
 * Page title, mobile hamburger, and connection status.
 */

import { usePathname } from "next/navigation";
import ThemeToggle from "@/components/theme-toggle";

const pageTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/overview": "Overview",
  "/inbox": "Inbox",
  "/ai-setter": "AI Setter",
  "/campaigns/import": "Import Campaigns",
  "/campaigns": "Campaigns",
  "/campaigns/new": "New Campaign",
  "/automations": "Campaigns",
  "/automations/new": "New Campaign",
  "/logs": "DM Logs",
  "/settings": "Settings",
  "/diagnostics": "Diagnostics",
};

interface TopBarProps {
  onMenuClick: () => void;
  instagramUsername: string | null;
  instagramAccountCount: number;
}

export default function TopBar({
  onMenuClick,
  instagramUsername,
  instagramAccountCount,
}: TopBarProps) {
  const pathname = usePathname();
  const title =
    pageTitles[pathname] ??
    (pathname.startsWith("/campaigns/") ? "Campaign" : "Dashboard");

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background pt-[env(safe-area-inset-top)]">
      <div className="flex h-14 items-center justify-between gap-3 px-4 lg:h-16 lg:px-8">
        <div className="flex min-w-0 items-center gap-3 lg:gap-4">
          <button
            type="button"
            onClick={onMenuClick}
            className="lg:hidden inline-flex min-h-11 min-w-11 items-center justify-center rounded border border-border px-2 text-sm text-muted hover:text-foreground"
            aria-label="Open menu"
          >
            Menu
          </button>
          <h1 className="truncate text-base font-semibold lg:text-lg">{title}</h1>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {instagramAccountCount > 0 ? (
            <p className="hidden max-w-40 truncate text-sm text-muted sm:block">
              {instagramAccountCount > 1
                ? `${instagramAccountCount} accounts`
                : `@${instagramUsername}`}
            </p>
          ) : (
            <a
              href="/api/instagram/connect"
              className="inline-flex min-h-11 items-center rounded bg-accent px-3 text-sm font-medium text-white hover:bg-accent-hover lg:min-h-0 lg:py-1.5"
            >
              Connect
              <span className="hidden sm:inline">&nbsp;Instagram</span>
            </a>
          )}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
