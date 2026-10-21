"use client";

import { useEffect, useRef, useState } from "react";

/**
 * THE LANDING'S ONE MOVING THING, AND IT IS THE PRODUCT.
 *
 * The hero behind this is a video because a still page cannot show what
 * cipher does — and footage cannot either. A rocket says "ambition" and a
 * chart says "trading", and neither says the thing that is actually different
 * here, which is that you TYPE the order and the hard parts come with it.
 *
 * So the video is weather and this is the subject: cipher's own prompt bar,
 * writing sentences it genuinely accepts. Every line below compiles — a stop,
 * a ladder, a trailing stop, a resting buy, a partial sell — and each one is
 * a thing that takes four screens of settings everywhere else. That is the
 * claim, demonstrated rather than asserted, in the time it takes to read it.
 *
 * NOTHING HERE IS INVENTED. CLAUDE.md's rule is that nothing on screen may
 * be fiction, and a landing page is the easiest place in a product to break
 * it. These are not aspirational sentences: they are the grammar's own test
 * cases, so a visitor who types one gets what the page showed them.
 */

/*
 * Capability, in the order a trader meets it. The first line is the one most
 * people will read all of — a buy and a stop in nine words — and the ones
 * after it are what they cannot do anywhere without a settings screen.
 */
const LINES = [
  "buy $500 of SOL and stop it at −10%",
  "sell a third at 2×, stop the rest at −50%",
  "buy the dip at $90, trail 15% off the high",
  "sell 30% of my BONK if it breaks $0.000021",
  "take profit in three rungs — 2×, 3×, 5×",
] as const;

/*
 * Typing is fast, deleting is faster, and the hold is long enough to read.
 *
 * A reel that moves at a constant rate reads as a machine demo. These are
 * roughly a quick typist: 34ms a character out, 16ms back, and 2.2 seconds
 * on the finished sentence — which is about how long a nine-word line takes
 * to land. The gap after deleting stops the next line starting mid-blink.
 */
const TYPE_MS = 34;
const ERASE_MS = 16;
const HOLD_MS = 2200;
const GAP_MS = 420;

export function PromptReel() {
  const [shown, setShown] = useState("");
  const [index, setIndex] = useState(0);
  /*
   * THE DIRECTION HAS TO BE STATE, not something read back off the text.
   *
   * The first version inferred it: "is what is shown a prefix of the line?
   * then keep typing". Every string is a prefix of itself minus its last
   * character, so the moment the hold expired and one character came off, the
   * same test put it straight back on. The reel typed one line, then blinked
   * its final character forever — convincingly enough that it looked like a
   * caret rather than a bug.
   */
  const [erasing, setErasing] = useState(false);
  /* Until this flips, the first line is rendered whole and still — see the
     reduced-motion branch below, and the server render it has to match. */
  const [animate, setAnimate] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    /*
     * REDUCED MOTION GETS THE SENTENCE, NOT NOTHING.
     *
     * The point of this element is the words. Someone who has asked their
     * system for less movement still needs to read what cipher takes, so the
     * animation is what is dropped — never the content.
     */
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still) {
      setShown(LINES[0]);
      return;
    }
    setAnimate(true);
  }, []);

  useEffect(() => {
    if (!animate) return;
    const full = LINES[index];

    /* One timeout at a time, re-armed from whatever state it lands in. An
       interval would keep firing through a tab switch and arrive back with a
       queue of frames to catch up on. */
    const after = (ms: number, run: () => void) => {
      timer.current = window.setTimeout(run, ms);
    };

    if (!erasing) {
      if (shown.length < full.length) after(TYPE_MS, () => setShown(full.slice(0, shown.length + 1)));
      else after(HOLD_MS, () => setErasing(true));
    } else if (shown.length > 0) {
      after(ERASE_MS, () => setShown(shown.slice(0, -1)));
    } else {
      after(GAP_MS, () => {
        setIndex((i) => (i + 1) % LINES.length);
        setErasing(false);
      });
    }

    return () => window.clearTimeout(timer.current);
  }, [shown, index, animate, erasing]);

  return (
    <div className="landing-reel">
      <span className="landing-reel-chip">SOL/USDC</span>
      {/* The animation is decoration; the sentences are not. A reader who
          gets this as text should get all of them, finished, at once —
          rather than one line caught mid-keystroke. */}
      <span className="landing-reel-text" aria-hidden="true">
        {shown}
        {animate && <span className="landing-caret" />}
      </span>
      <span className="sr-only">
        Orders cipher takes in plain English: {LINES.join("; ")}.
      </span>
      <span className="landing-reel-go" aria-hidden="true">
        →
      </span>
    </div>
  );
}
