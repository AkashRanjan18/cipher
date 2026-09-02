/**
 * The feature grid.
 *
 * Content lives in an array rather than in JSX so adding a feature is one
 * object, not a copy-pasted block of markup that drifts from its siblings.
 *
 * Order is deliberate: the four things nobody else has come first, the
 * social layer second, the plumbing last. A visitor who reads only the top
 * row should already know why cipher is not another terminal.
 *
 * Server component — static text, no interactivity.
 */

interface Feature {
  eyebrow: string;
  title: string;
  body: string;
}

const features: Feature[] = [
  // ─── what nobody else has ───────────────────────────────────────────
  {
    eyebrow: "PROMPT",
    title: "No settings. Just say it.",
    body: "Slippage, priority fee, private routing, position size. The knobs every other app hands you and most people set wrong. Describe the trade instead.",
  },
  {
    eyebrow: "RULES",
    title: "It trades while you don't.",
    body: "Your exit is decided once, in words, and then it runs. Take-profit ladders, trailing stops, and exits keyed to a date rather than a price.",
  },
  {
    eyebrow: "THE LINTER",
    title: "It argues before it obeys.",
    body: "A stop tighter than the token's hourly volatility. An order larger than the pool can fill. A take-profit below your round-trip cost. You are told first.",
  },
  {
    eyebrow: "LIVE LOG",
    title: "Watch the engine think.",
    body: "Every price check, every threshold, every abort, streaming. The only honest answer to why you should trust a backend with a standing order.",
  },

  // ─── social ──────────────────────────────────────────────────────────
  {
    eyebrow: "LEADERBOARD",
    title: "Ranked by what you made other people.",
    body: "Not your own P&L. A trader whose followers lost money ranks below one whose followers didn't — and unlike your own returns, that can't be faked.",
  },
  {
    eyebrow: "COPY",
    title: "Copy a policy, not a wallet.",
    body: "Follow the trader, cap the size, skip the leverage, keep your own exit. Copy trading you can survive. Leaders earn from your profit, not your volume.",
  },
  {
    eyebrow: "FEED",
    title: "See the position and the reasoning.",
    body: "Live trades with realised P&L attached, and the thesis the trader wrote when they opened it. Discussion sits under the chart, not scattered across Discord.",
  },
  {
    eyebrow: "CLANS",
    title: "Trade as a squad.",
    body: "Share an exit discipline, run a clan board, get ranked on collective saves. Belonging outlasts a good week; a leaderboard position doesn't.",
  },

  // ─── plumbing ────────────────────────────────────────────────────────
  {
    eyebrow: "EXECUTION",
    title: "Three venues, best fill.",
    body: "Every order quoted across competing routers in parallel, MEV-protected, and checked against real pool depth before it fires. Gas is on us.",
  },
  {
    eyebrow: "YOUR KEYS",
    title: "Non-custodial, and provably so.",
    body: "A wallet appears when you sign in. No seed phrase to lose, and the export button is in the header rather than buried six screens deep.",
  },
  {
    eyebrow: "ONBOARDING",
    title: "Apple or Google. That's the form.",
    body: "No seed phrase, no extension, no bridge, no gas token. Sign in and the wallet is already there.",
  },
  {
    eyebrow: "RECEIPTS",
    title: "Every rule leaves proof.",
    body: "When a stop fires, you get the rule, the fill, and the price two hours later — verifiable on-chain. Screenshot it or don't.",
  },
];

export function Features() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24 sm:py-32">
      <h2 className="mb-3 font-display text-3xl font-light sm:text-4xl">
        Everything the terminal does.
        <br />
        <span className="text-ash">Plus the part it won&rsquo;t.</span>
      </h2>

      <div className="mt-14 grid gap-px overflow-hidden rounded-xl bg-champagne/10 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((f) => (
          <article key={f.eyebrow} className="bg-ink p-7 sm:p-8">
            <p className="font-mono text-[10px] tracking-[0.25em] text-ash">
              {f.eyebrow}
            </p>
            <h3 className="mt-4 font-display text-xl font-light leading-snug text-champagne">
              {f.title}
            </h3>
            <p className="mt-3 font-sans text-sm leading-relaxed text-ash">
              {f.body}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
