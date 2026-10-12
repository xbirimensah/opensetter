"use client";

/**
 * Sidebar Navigation
 *
 * The heavier chrome material. From lg up it floats beside the content;
 * on phones and tablets it is a drawer over the content, dimmed behind,
 * that leaves the way it came (to the left). Items are grouped by what
 * they do: results, conversations, then setup at the bottom.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import {
  AiSetterIcon,
  CloseIcon,
  DashboardIcon,
  DiagnosticsIcon,
  FlowsIcon,
  InboxIcon,
  LogsIcon,
  OverviewIcon,
  SettingsIcon,
} from "@/components/nav-icons";

type NavIcon = ComponentType<{ size?: number; className?: string }>;

interface NavItem {
  label: string;
  href: string;
  icon: NavIcon;
  /** Other path prefixes that belong to this item. */
  alsoActiveOn?: string[];
}

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: DashboardIcon },
  { label: "Overview", href: "/overview", icon: OverviewIcon },
  { label: "Inbox", href: "/inbox", icon: InboxIcon },
  { label: "AI Setter", href: "/ai-setter", icon: AiSetterIcon },
  {
    label: "Flows",
    href: "/flows",
    icon: FlowsIcon,
    alsoActiveOn: ["/campaigns", "/automations"],
  },
  { label: "DM Logs", href: "/logs", icon: LogsIcon },
  { label: "Settings", href: "/settings", icon: SettingsIcon },
  { label: "Diagnostics", href: "/diagnostics", icon: DiagnosticsIcon },
];

/** Where each group ends: results, conversations, setup. */
const GROUPS: Array<[number, number]> = [
  [0, 2],
  [2, 6],
  [6, 8],
];

function matches(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

function isItemActive(pathname: string, item: NavItem) {
  return [item.href, ...(item.alsoActiveOn ?? [])].some((prefix) =>
    matches(pathname, prefix)
  );
}

interface SidebarProps {
  isOpen: boolean;
  /** True from lg up, where the sidebar is always on screen. */
  isDesktop: boolean;
  onClose: () => void;
  workspaceName: string;
}

export default function Sidebar({
  isOpen,
  isDesktop,
  onClose,
  workspaceName,
}: SidebarProps) {
  const pathname = usePathname();
  const initial = workspaceName.trim().charAt(0).toUpperCase() || "W";

  return (
    <>
      {/* Focus dim behind the drawer. Always mounted so it can fade out. */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className={`app-scrim fixed inset-0 z-40 lg:hidden ${
          isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      <aside
        id="app-sidebar"
        aria-label="Main navigation"
        tabIndex={-1}
        // Off screen on phones while closed: keep it out of the tab order.
        inert={!isOpen && !isDesktop}
        className={`app-drawer material-sidebar fixed inset-y-2 left-2 z-50 flex outline-none w-72 max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-[22px]
          lg:static lg:z-auto lg:my-2 lg:ml-2 lg:w-60 lg:max-w-none lg:shrink-0 lg:translate-x-0 lg:rounded-[20px]
          ${isOpen ? "translate-x-0" : "-translate-x-[calc(100%+1rem)]"}`}
      >
        <div className="flex min-h-14 items-center justify-between gap-2 px-5 pt-[env(safe-area-inset-top)] lg:min-h-16 lg:pt-0">
          <Link
            href="/dashboard"
            onClick={onClose}
            className="press -mx-1 rounded-lg px-1 text-[1.0625rem] font-bold tracking-[-0.02em] text-foreground active:opacity-70"
          >
            OpenSetter
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="press -mr-2 inline-flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-fill hover:text-foreground lg:hidden"
          >
            <CloseIcon size={20} />
          </button>
        </div>

        <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-3">
          {GROUPS.map(([start, end], groupIndex) => (
            <ul
              key={start}
              className={`space-y-0.5 ${
                groupIndex === GROUPS.length - 1 ? "mt-auto pt-6" : groupIndex > 0 ? "mt-5" : ""
              }`}
            >
              {navItems.slice(start, end).map((item) => {
                const isActive = isItemActive(pathname, item);
                const ItemIcon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onClose}
                      aria-current={isActive ? "page" : undefined}
                      className={`press group flex min-h-11 items-center gap-3 rounded-xl px-3 text-[0.9375rem] lg:min-h-9 lg:text-sm ${
                        isActive
                          ? "bg-fill-strong font-semibold text-foreground"
                          : "text-muted hover:bg-fill hover:text-foreground active:bg-fill-strong"
                      }`}
                    >
                      <ItemIcon
                        size={19}
                        className={`shrink-0 ${
                          isActive ? "text-accent" : "text-faint group-hover:text-muted"
                        }`}
                      />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ))}
        </nav>

        <div className="flex items-center gap-3 border-t border-[var(--material-edge)] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:pb-3">
          <span
            aria-hidden="true"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-fill-strong text-footnote font-semibold text-foreground"
          >
            {initial}
          </span>
          <div className="min-w-0">
            <p className="truncate text-footnote font-semibold text-foreground">
              {workspaceName}
            </p>
            <p className="text-caption text-faint">Self-hosted</p>
          </div>
        </div>
      </aside>
    </>
  );
}
