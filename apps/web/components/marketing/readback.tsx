/**
 * The one block that shows what cipher actually does.
 *
 * Kept deliberately light: a chat-style bubble of what you type, then what
 * happens. The earlier version was a monospace spec table with fields like
 * SLIPPAGE and ROUTE — accurate, and it read like a config file. A trader
 * skimming this should feel "oh, that's easy", not "I need to learn this".
 *
 * Server component. No state.
 */

const outcome = [
  "bought $500 of BONK",
  "selling a third at 2×",
  "stopping the rest at −50%",
];

export function Readback() {
  return (
    <div className="mx-auto w-full max-w-xl">
      {/* What you type. Right-aligned bubble, like a message you sent. */}
      <div className="flex justify-end">
        <p className="max-w-md rounded-3xl rounded-br-lg bg-champagne px-6 py-4 font-sans text-base leading-relaxed text-ink">
          buy me $500 of bonk, sell a third at 2x and stop the rest at -50%
        </p>
      </div>

      {/* What happens. Left-aligned, like the reply. */}
      <div className="mt-4 flex justify-start">
        <div className="max-w-md rounded-3xl rounded-bl-lg bg-slate px-6 py-5">
          <p className="font-sans text-sm text-ash">done — here&rsquo;s what&rsquo;s live:</p>
          <ul className="mt-3 space-y-2">
            {outcome.map((line) => (
              <li
                key={line}
                className="flex items-start gap-3 font-sans text-base text-champagne"
              >
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-champagne/60" />
                {line}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className="mt-10 text-center font-display text-xl text-ash">
        no menus. no settings. no leverage sliders.
      </p>
    </div>
  );
}
