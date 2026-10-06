"use client";

/**
 * Theme toggle: dark (default) or light, persisted in localStorage and
 * applied via data-theme on <html>. The inline script in the root
 * layout applies the stored value before first paint.
 */

import { useEffect, useState } from "react";

type Theme = "dark" | "light";

function readTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
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
    if (next === "light") {
      document.documentElement.dataset.theme = "light";
    } else {
      delete document.documentElement.dataset.theme;
    }
    try {
      localStorage.setItem("theme", next);
    } catch {
      // Private mode etc.; the toggle still works for this page view.
    }
    setTheme(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={
        theme === "light" ? "Switch to dark mode" : "Switch to light mode"
      }
      title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded border border-border px-2 py-1 text-sm text-muted hover:border-border-hover hover:text-foreground lg:min-h-0 lg:min-w-0"
    >
      {theme === null ? "…" : theme === "light" ? "Dark" : "Light"}
    </button>
  );
}
