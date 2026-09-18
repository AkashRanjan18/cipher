"use client";

import type { CSSProperties } from "react";
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
/**
 * Wheel distance, as a fraction of what the browser would move.
 *
 * 0.6 by instruction. The default is tuned for documents; in a panel of 48px
 * rows it overshoots by two or three rows on a single notch, and you arrive
 * somewhere you have to scroll back from.
 */
const WHEEL_RATE = 0.6;

export function Scroller({
  children,
  className = "",
  /** Bar length in pixels. Fixed, which is the entire point. */
  barHeight = 48,
  style,
}: {
  children: ReactNode;
  /** Sizing for the outer box. This is the flex/grid child, not the scroller. */
  className?: string;
  barHeight?: number;
  /** For sizes a class cannot express — a row-count cap, say. */
  style?: CSSProperties;
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

    /*
     * A slower wheel.
     *
     * Bound by hand rather than with onWheel, because React attaches wheel
     * listeners as PASSIVE — preventDefault inside a React handler is ignored
     * and logs a console warning, so the page would keep scrolling at full
     * speed and the multiplier would look like it did nothing.
     *
     * CAPTURE PHASE, and that is not optional. Scrolling is the wheel event's
     * DEFAULT ACTION on the nearest scrollable ancestor — stopPropagation does
     * not stop it, only preventDefault does. The chart stops propagation, so a
     * bubble-phase listener here never ran, never called preventDefault, and
     * the region scrolled natively underneath a zoom. Capture runs before the
     * chart sees the event, so the default can still be suppressed; the chart
     * then receives it and zooms as normal.
     */
    const onWheel = (e: WheelEvent) => {
      /*
       * SOME THINGS OWN THEIR OWN WHEEL.
       *
       * The chart zooms on wheel. That event bubbles up here, so a zoom also
       * scrolled the region under it — the candles got closer and the whole
       * column slid at the same time.
       *
       * preventDefault and return, rather than just return: returning alone
       * leaves the browser to scroll the container natively, which is the
       * behaviour we are trying to stop. The chart's own handler has already
       * run by now — wheel bubbles from the target upward — so suppressing the
       * default here cannot undo its zoom.
       *
       * An explicit attribute rather than checking defaultPrevented, because
       * that would make this depend on a third-party library continuing to
       * call preventDefault in every case, including at its zoom limits.
       */
      const target = e.target as Element | null;

      /*
       * TWO KINDS OF "NOT YOURS", and they need opposite treatment.
       *
       * data-wheel-lock means SUPPRESS: the chart zooms on wheel and has
       * already handled it, so the default must be killed or the column
       * slides while the candles zoom.
       *
       * data-wheel-pass means STAND ASIDE: a dropdown scrolls itself, and
       * this handler is registered in the CAPTURE phase, so preventDefault
       * here happens before the browser has done anything — it does not
       * merely stop this region scrolling, it stops the menu scrolling too.
       * That is why the zone list could only be moved by dragging its bar.
       * Returning without preventDefault leaves the native scroll intact, and
       * overscroll-contain on the menu stops the chain at its ends.
       */
      if (target?.closest?.("[data-wheel-pass]")) return;
      if (target?.closest?.("[data-wheel-lock]")) {
        e.preventDefault();
        return;
      }

      /*
       * At either end, do nothing and let the event through. Swallowing it
       * would trap the pointer: a panel scrolled to its bottom would eat every
       * notch instead of passing it to whatever is behind.
       */
      const max = el.scrollHeight - el.clientHeight;
      if ((e.deltaY < 0 && el.scrollTop <= 0) || (e.deltaY > 0 && el.scrollTop >= max - 1)) {
        return;
      }
      e.preventDefault();
      el.scrollTop += e.deltaY * WHEEL_RATE;
    };
    el.addEventListener("wheel", onWheel, { passive: false, capture: true });

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
      el.removeEventListener("wheel", onWheel, { capture: true });
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
    <div className={`relative ${className}`} style={style}>
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
