"use client";

import { useRef, type PointerEvent as ReactPointerEvent } from "react";

/**
 * GRAB A ROW AND PULL IT SIDEWAYS.
 *
 * The filter chips overflow their panel — "Bonding" and "Watchlist" sit past
 * the right edge — and there is no horizontal scrollbar to reach them with,
 * because the row hides it deliberately. A trackpad can swipe; a mouse could
 * do nothing at all.
 *
 * MOVEMENT DECIDES WHETHER IT WAS A DRAG. A chip is a button, so the handler
 * cannot swallow every press: it tracks distance and only suppresses the click
 * once the pointer has travelled past a threshold. Below that, the press is a
 * press and the chip selects normally.
 *
 * POINTER CAPTURE IS TAKEN LATE, and taking it early is what broke the chips.
 * Capturing on pointerdown retargets everything that follows to the capturing
 * element, so the browser fires `click` at the ROW rather than at the chip
 * inside it — every filter stopped selecting the moment the row became
 * draggable. It is claimed only once the pointer has actually moved past the
 * threshold, by which point the press is a drag and there is no click to
 * lose.
 */
const DRAG_THRESHOLD = 4;

export function useDragScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const from = useRef<{ x: number; scroll: number } | null>(null);
  const moved = useRef(0);
  /** Whether the pointer has been claimed. See the note above. */
  const captured = useRef(false);

  const onPointerDown = (e: ReactPointerEvent<T>) => {
    /* Left button only. A middle-click drag is the browser's autoscroll and a
       right-click is a context menu; claiming either would be rude. */
    if (e.button !== 0 || !ref.current) return;
    from.current = { x: e.clientX, scroll: ref.current.scrollLeft };
    moved.current = 0;
    captured.current = false;
  };

  const onPointerMove = (e: ReactPointerEvent<T>) => {
    const start = from.current;
    if (!start || !ref.current) return;
    const dx = e.clientX - start.x;
    moved.current = Math.max(moved.current, Math.abs(dx));
    if (moved.current <= DRAG_THRESHOLD) return;
    if (!captured.current) {
      captured.current = true;
      ref.current.setPointerCapture(e.pointerId);
    }
    ref.current.scrollLeft = start.scroll - dx;
  };

  const end = (e: ReactPointerEvent<T>) => {
    if (!from.current) return;
    from.current = null;
    if (captured.current) {
      captured.current = false;
      ref.current?.releasePointerCapture?.(e.pointerId);
    }
  };

  /* Capture phase, so the chip's own onClick never runs when the press was
     really a drag. Reset afterwards, or the next genuine click is eaten. */
  const onClickCapture = (e: ReactPointerEvent<T> | React.MouseEvent<T>) => {
    if (moved.current > DRAG_THRESHOLD) {
      e.preventDefault();
      e.stopPropagation();
    }
    moved.current = 0;
  };

  return {
    ref,
    dragging: from,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: end,
      onPointerCancel: end,
      onClickCapture,
    },
  };
}
