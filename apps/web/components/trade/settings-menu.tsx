"use client";

import { useEffect, useRef, useState } from "react";
import { WALLPAPERS } from "@/lib/wallpapers";
import { useWallpaper } from "@/components/ui/use-wallpaper";

/**
 * Terminal settings, behind the gear in the header.
 *
 * ONE SECTION, NO TAB STRIP. Background is the only setting that lives here
 * today, and a row of tabs with one tab in it is a control that chooses
 * nothing (CLAUDE.md: "One tab is not a choice"). The section has a heading so
 * a second one slots in beside it; the tabs arrive with that second section.
 *
 * Execution settings — slippage, routing — stay on the ticket's own gear,
 * where fomo keeps them: they belong to an order, not to the screen.
 *
 * Mounted permanently in the header, which is also what applies the saved
 * wallpaper on load: the hook runs whether or not the menu is ever opened.
 */
export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const [wallpaper, setWallpaper] = useWallpaper();
  const box = useRef<HTMLDivElement>(null);

  /* Same closing rules as the account menu beside it. */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={box} className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Settings"
        title="Settings"
        className={`grid h-8 w-8 place-items-center rounded-full border border-line font-mono text-[15px] transition-colors ${
          open ? "text-accent" : "text-ash hover:text-champagne"
        }`}
      >
        ⚙
      </button>

      {/* bg-ink, not bg-panel: panels go translucent over a wallpaper, and a
          menu with the ticket showing through it is unreadable. */}
      {open && (
        <div
          role="dialog"
          aria-label="Settings"
          className="absolute right-0 top-full z-40 mt-2 w-[19rem] rounded-xl border border-line bg-ink p-3 shadow-2xl"
        >
          <div className="flex items-baseline justify-between">
            <span className="font-sans text-[10px] font-bold uppercase tracking-[0.11em] text-ash">
              Background
            </span>
            <span className="font-sans text-[10px] text-mute">Free · saved in this browser</span>
          </div>

          <div className="mt-2.5 grid grid-cols-3 gap-2">
            {WALLPAPERS.map((w) => {
              const on = w.id === wallpaper;
              return (
                <button
                  key={w.id}
                  onClick={() => setWallpaper(w.id)}
                  aria-pressed={on}
                  className="group flex flex-col gap-1 text-left"
                >
                  {/* The tile IS the wallpaper, drawn by the same CSS the page
                      uses — a preview that cannot disagree with the result. */}
                  <span
                    className={`block h-14 w-full rounded-lg border transition-colors ${
                      on ? "border-accent" : "border-line group-hover:border-ash"
                    }`}
                    style={{ background: w.css ?? "var(--color-ink)" }}
                  />
                  <span
                    className={`font-sans text-[10.5px] ${on ? "font-bold text-accent" : "text-ash group-hover:text-champagne"}`}
                  >
                    {w.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
