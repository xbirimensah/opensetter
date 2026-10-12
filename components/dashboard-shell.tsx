"use client";

import { useEffect, useRef, useState } from "react";
import MobileNav from "@/components/mobile-nav";
import Sidebar from "@/components/sidebar";
import TopBar from "@/components/top-bar";
import { useMediaQuery } from "@/components/inbox/use-media-query";

interface DashboardShellProps {
  children: React.ReactNode;
  workspaceName: string;
  instagramUsername: string | null;
  instagramAccountCount: number;
}

/** Scrolled this far, content is under the top bar and its material shows. */
const SCROLLED_PX = 4;

export default function DashboardShell({
  children,
  workspaceName,
  instagramUsername,
  instagramAccountCount,
}: DashboardShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  // Where focus was before the drawer opened, to hand it back on close.
  const returnFocusRef = useRef<HTMLElement | null>(null);

  function openSidebar() {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    setSidebarOpen(true);
  }

  function closeSidebar() {
    setSidebarOpen(false);
  }

  // Escape closes the mobile drawer, like any other dialog. Opening moves
  // focus into it; closing returns focus to the control that opened it.
  useEffect(() => {
    if (!sidebarOpen) return;
    // Focus the drawer itself (not its first link) so no ring flashes on a
    // tap; Tab then moves straight into the navigation.
    document.getElementById("app-sidebar")?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      returnFocusRef.current?.focus({ preventScroll: true });
    };
  }, [sidebarOpen]);

  // iOS Safari only applies :active (the press feedback) when a touch
  // listener exists; a passive no-op is enough.
  useEffect(() => {
    const noop = () => {};
    document.addEventListener("touchstart", noop, { passive: true });
    return () => document.removeEventListener("touchstart", noop);
  }, []);

  function onMainScroll(event: React.UIEvent<HTMLElement>) {
    const next = event.currentTarget.scrollTop > SCROLLED_PX;
    // React bails out when the value is unchanged, so this only renders on
    // the two crossings.
    setScrolled(next);
  }

  return (
    // h-dvh, not h-screen: on phones 100vh includes the collapsing browser
    // chrome and pushes the bottom of the app off screen.
    <div className="flex h-dvh overflow-hidden bg-background">
      <Sidebar
        isOpen={sidebarOpen}
        isDesktop={isDesktop}
        onClose={closeSidebar}
        workspaceName={workspaceName}
      />

      {/* The scroll container holds the top bar, so content passes under
          the translucent bar instead of stopping at a divider. */}
      <main
        onScroll={onMainScroll}
        className="relative min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
      >
        <TopBar
          onMenuClick={openSidebar}
          menuOpen={sidebarOpen}
          scrolled={scrolled}
          instagramUsername={instagramUsername}
          instagramAccountCount={instagramAccountCount}
        />

        {/* Bottom padding clears the fixed tab bar and the home indicator. */}
        <div className="mx-auto max-w-7xl px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-2 lg:px-8 lg:pb-10 lg:pt-3">
          {children}
        </div>
      </main>

      <MobileNav onMoreClick={openSidebar} moreOpen={sidebarOpen} />
    </div>
  );
}
