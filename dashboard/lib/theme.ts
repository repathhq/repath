/**
 * Light/dark theme, shared by every surface: marketing pages, the app shell.
 *
 * The theme lives on <html data-lp-theme>, written by a blocking inline
 * script in app/layout.tsx before first paint, so no page flashes the wrong
 * theme on load. Components subscribe to that attribute rather than owning
 * it: mirroring it into React state through an effect would repaint after
 * hydration and bring back the flash the script exists to prevent.
 *
 * One store, so a choice made on the landing page holds on /pricing and in
 * the dashboard. The landing page and the app shell each kept their own copy
 * of this before; two copies is how one of them eventually stops agreeing.
 */

import { useCallback, useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const THEME_KEY = "repath-landing-theme";
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function read(): Theme {
  return document.documentElement.dataset.lpTheme === "dark" ? "dark" : "light";
}

// The server has no DOM and no storage, so it renders light — matching what
// the inline script paints before React arrives.
function readOnServer(): Theme {
  return "light";
}

function write(next: Theme) {
  document.documentElement.dataset.lpTheme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // Private browsing or storage disabled: the choice still applies now.
  }
  listeners.forEach((l) => l());
}

export function useTheme(): [Theme, (next: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, read, readOnServer);
  const set = useCallback((next: Theme) => write(next), []);
  return [theme, set];
}
