"use client";

import { useEffect, useState } from "react";
import MobileNav from "@/components/mobile-nav";
import Sidebar from "@/components/sidebar";
import TopBar from "@/components/top-bar";

interface DashboardShellProps {
  children: React.ReactNode;
  workspaceName: string;
  instagramUsername: string | null;
  instagramAccountCount: number;
}

export default function DashboardShell({
  children,
  workspaceName,
  instagramUsername,
  instagramAccountCount,
}: DashboardShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Escape closes the mobile drawer, like any other dialog.
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sidebarOpen]);

  return (
    // h-dvh, not h-screen: on phones 100vh includes the collapsing browser
    // chrome and pushes the bottom of the app off screen.
    <div className="flex h-dvh overflow-hidden bg-background">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        workspaceName={workspaceName}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar
          onMenuClick={() => setSidebarOpen(true)}
          instagramUsername={instagramUsername}
          instagramAccountCount={instagramAccountCount}
        />

        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          {/* Bottom padding clears the fixed mobile nav and the home indicator. */}
          <div className="mx-auto max-w-7xl px-4 py-6 pb-[calc(5rem+env(safe-area-inset-bottom))] lg:px-8 lg:pb-6">
            {children}
          </div>
        </main>
      </div>

      <MobileNav onMoreClick={() => setSidebarOpen(true)} />
    </div>
  );
}
