"use client";

import { useEffect, useState } from "react";

export const THEME_KEY = "portus.theme";

/** Light/dark toggle. Default light; persisted to localStorage; applied as html.light / html.dark. */
export function ThemeToggle() {
  const [light, setLight] = useState(true);
  useEffect(() => {
    setLight(document.documentElement.classList.contains("light"));
  }, []);
  const flip = () => {
    const next = !light;
    setLight(next);
    document.documentElement.classList.toggle("light", next);
    document.documentElement.classList.toggle("dark", !next);
    try {
      localStorage.setItem(THEME_KEY, next ? "light" : "dark");
    } catch {
      /* ignore */
    }
  };
  return (
    <button
      type="button"
      onClick={flip}
      aria-label={light ? "Dark mode" : "Light mode"}
      title={light ? "Dark / 深色" : "Light / 浅色"}
      className="grid h-8 w-8 place-items-center rounded-full border border-line text-fg-muted transition-colors hover:text-fg"
    >
      {light ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="12" cy="12" r="4.5" />
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      )}
    </button>
  );
}
