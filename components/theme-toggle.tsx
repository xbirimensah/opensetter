"use client";

/**
 * Theme toggle: dark (default) or light, persisted in localStorage and
 * applied via data-theme on <html>. The inline script in the root
 * layout applies the stored value before first paint. The switch itself
 * cross-fades (View Transitions) so the brightness change is eased, not
 * a flash; with reduced motion it is instant.
 */

import { useEffect, useState } from "react";
import { MoonIcon, SunIcon } from "@/components/nav-icons";

type Theme = "dark" | "light";

function readTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function applyTheme(next: Theme) {
  if (next === "light") {
    document.documentElement.dataset.theme = "light";
  } else {
    delete document.documentElement.dataset.theme;
  }
}

export default function ThemeToggle() {
  // Render a stable placeholder until mounted; the real state comes from
  // the DOM attribute the pre-paint script already set.
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    // Mount-time read of the DOM attribute set by the pre-paint script;
    // it cannot be read during render without a hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(readTheme());
  }, []);

  function toggle() {
    const next: Theme = readTheme() === "light" ? "dark" : "light";
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduceMotion && typeof document.startViewTransition === "function") {
      document.startViewTransition(() => applyTheme(next));
    } else {
      applyTheme(next);
    }
    try {
      localStorage.setItem("theme", next);
    } catch {
      // Private mode etc.; the toggle still works for this page view.
    }
    setTheme(next);
  }

  const label = theme === "light" ? "Switch to dark mode" : "Switch to light mode";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="press inline-flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-fill hover:text-foreground lg:h-9 lg:w-9"
    >
      {/* Shows the mode you switch to, like the label says. */}
      {theme === "light" ? <MoonIcon size={19} /> : <SunIcon size={19} />}
    </button>
  );
}
