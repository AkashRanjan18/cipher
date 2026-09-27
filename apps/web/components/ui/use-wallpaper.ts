"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_WALLPAPER, wallpaperById } from "@/lib/wallpapers";

const KEY = "cipher:wallpaper";

/**
 * The chosen background: remembered in this browser, applied to the page.
 *
 * APPLIED AS AN ATTRIBUTE ON <html>, not as React state threaded down to the
 * shell. The whole effect is CSS — the shell shows the wallpaper and every
 * panel turns translucent over it (globals.css, `[data-wallpaper]`). One
 * attribute switches all of that at once without re-rendering the terminal,
 * which is holding a live chart and a price socket and has no reason to
 * redraw because the picture behind it changed.
 *
 * cipher: localStorage, so the choice is per-browser. A preference this
 * small does not justify a column in Postgres; if accounts ever sync
 * settings across devices, this is the one line that reads from them.
 */
export function useWallpaper(): [string, (id: string) => void] {
  const [id, setId] = useState(DEFAULT_WALLPAPER);

  /* Read after mount: the server has no localStorage, and rendering the
     stored value on the first pass would not match what the server sent. */
  useEffect(() => {
    try {
      setId(wallpaperById(window.localStorage.getItem(KEY)).id);
    } catch {
      /* Storage blocked (private window, strict settings): plain ground. */
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const w = wallpaperById(id);
    if (w.css) {
      root.dataset.wallpaper = w.id;
      root.style.setProperty("--wallpaper", w.css);
    } else {
      delete root.dataset.wallpaper;
      root.style.removeProperty("--wallpaper");
    }
  }, [id]);

  const choose = useCallback((next: string) => {
    setId(next);
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      /* Applied for this visit even when it cannot be remembered. */
    }
  }, []);

  return [id, choose];
}
