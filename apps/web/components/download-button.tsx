"use client";

/**
 * TODO: this has no destination yet.
 *
 * There is no App Store listing — Apple guideline 3.1.5(b) requires an
 * organisation developer account for wallet apps, which requires a legal
 * entity and a D-U-N-S number. The plan is Telegram and a PWA instead.
 *
 * Once decided, this becomes one of:
 *   - PWA install  (beforeinstallprompt on Android/Chrome, "Add to Home
 *                   Screen" instructions on iOS)
 *   - Telegram bot deep link
 *   - a waitlist
 *
 * Left deliberately unwired rather than pointed somewhere invented.
 */
export function DownloadButton() {
  return (
    <button
      onClick={() => {}}
      className="rounded-full border border-champagne/30 px-8 py-3 font-sans text-sm text-champagne/90 backdrop-blur-sm transition-colors hover:border-champagne/70 hover:text-champagne focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-champagne"
    >
      Download app
    </button>
  );
}
