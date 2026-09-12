"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A scroll container with a bar we actually control.
 *
 * WHY THIS EXISTS, because a native scrollbar is nearly always the right answer
 * and this is the case where it is not.
 *
 * A native thumb's length is the ratio of visible content to total, and that is
 * not overridable: `height` is ignored on ::-webkit-scrollbar-thumb, and
 * `max-height` does not clamp it — it deletes the thumb outright, which is how
 * this file came to exist. The only lever CSS gives you is painting a shorter
 * bar inside the full-length thumb, and that strands the bar in the middle of
 * the track: at scroll zero the thumb's top is at the track's top, but the
 * painted part sits halfway down it.
 *
 * That is fatal here. The ticket column overflows by 71px in 558, so its thumb
 * is naturally about 89% of the track — long, and unshortenable without losing
 * the one thing a scrollbar is for.
 *
 * So: hide the native bar, render our own. Fixed length, travels the full track,
 * position is honest.
 *
 * cipher: wheel, trackpad, keyboard and touch all still work because the
 * container is a real overflow-y-auto element — only the INDICATOR is ours.
 * Dragging it is handled below; everything else is the browser's.
 */
export function Scroller({
  children,
  className = "",
  /** Bar length in pixels. Fixed, which is the entire point. */
  barHeight = 48,
}: {
  children: ReactNode;
  /** Sizing for the outer box. This is the flex/grid child, not the scroller. */
  className?: string;
  barHeight?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState<{ top: number; show: boolean }>({
    top: 0,
    show: false,
  });
  const drag = useRef<{ startY: number; startScroll: number } | null>(null);

  /**
   * Where the bar sits, from where the content sits.
   *
   * The bar travels (trackHeight - barHeight) while the content travels
   * (scrollHeight - clientHeight), so position is one ratio applied to the
   * other. Both ends land exactly: at scrollTop 0 the bar is at 0, at maximum
   * scroll it is flush with the bottom.
   */
  const measure = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const scrollable = el.scrollHeight - el.clientHeight;
    // A pixel or two of overflow is rounding, not content. A bar for that is
    // noise, and on a zoomed display every panel would grow one.
    if (scrollable <= 2) {
      setBar((b) => (b.show ? { top: 0, show: false } : b));
      return;
    }
    const travel = Math.max(0, el.clientHeight - barHeight);
    setBar({ top: (el.scrollTop / scrollable) * travel, show: true });
  }, [barHeight]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    measure();

    el.addEventListener("scroll", measure, { passive: true });
    /*
     * Content changes without a scroll event — a market list filtering down, a
     * card appearing in the ticket. ResizeObserver on the CHILD catches the
     * content growing; on the container itself it would only catch the window.
     */
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);

    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, [measure]);

  /*
   * Dragging, on the window rather than the bar.
   *
   * A pointer moving faster than React re-renders leaves the bar behind, and a
   * handler bound to the bar stops receiving events the moment the cursor is
   * outside it — the drag then sticks. Same reason the chart divider does this.
   */
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const el = box.current;
      const d = drag.current;
      if (!el || !d) return;
      const scrollable = el.scrollHeight - el.clientHeight;
      const travel = Math.max(1, el.clientHeight - barHeight);
      el.scrollTop = d.startScroll + ((e.clientY - d.startY) / travel) * scrollable;
    };
    const onUp = () => {
      if (!drag.current) return;
      drag.current = null;
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [barHeight]);

  return (
    <div className={`relative ${className}`}>
      {/* no-scrollbar hides the native one; the element is otherwise an
          ordinary scroll container, so wheel, trackpad, keyboard and touch are
          all the browser's own. */}
      <div ref={box} className="no-scrollbar h-full overflow-y-auto">
        {children}
      </div>

      {bar.show && (
        <span
          onPointerDown={(e) => {
            drag.current = {
              startY: e.clientY,
              startScroll: box.current?.scrollTop ?? 0,
            };
            // Or the drag selects the text it passes over.
            document.body.style.userSelect = "none";
          }}
          role="presentation"
          className="absolute right-0.5 w-1.5 cursor-grab rounded-full bg-mute transition-colors hover:bg-ash active:cursor-grabbing"
          style={{ top: bar.top, height: barHeight }}
        />
      )}
    </div>
  );
}
