/**
 * The feature grid.
 *
 * Copy rule for this file: a label and a short line. No paragraphs.
 * Long explanatory body copy is what made the first version read like
 * documentation instead of a product people want to use — a trader
 * skimming on a phone reads the headline and nothing else.
 *
 * Content lives in an array so adding a feature is one object rather than a
 * copy-pasted block of markup that drifts from its siblings.
 *
 * Server component. Static text, no interactivity.
 */

interface Feature {
  eyebrow: string;
  title: string;
}

const features: Feature[] = [
  { eyebrow: "JUST TYPE IT", title: "say it like you'd text a friend" },
  { eyebrow: "RULES", title: "it trades while you sleep" },
  { eyebrow: "LEADERBOARD", title: "get paid for making other people money" },
  { eyebrow: "COPY", title: "copy the good ones, skip their bad habits" },
  { eyebrow: "FEED", title: "see what everyone's buying, and why" },
  { eyebrow: "CLANS", title: "trade with your people" },
  { eyebrow: "ZERO COMPLEXITY", title: "multichain & gasless" },
  { eyebrow: "EASY ONBOARDING", title: "sign in. that's the whole form." },
  { eyebrow: "RECEIPTS", title: "every trade leaves proof onchain" },
];

export function Features() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24 sm:py-32">
      <h2 className="text-center font-display text-4xl leading-tight sm:text-5xl">
        everything you&rsquo;d expect.
        <br />
        <span className="text-ash">plus the part nobody built.</span>
      </h2>

      <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((f) => (
          <article
            key={f.eyebrow}
            className="rounded-2xl bg-slate p-7 transition-colors hover:bg-slate/70"
          >
            <p className="font-mono text-[10px] tracking-[0.2em] text-champagne/50">
              {f.eyebrow}
            </p>
            <h3 className="mt-5 font-display text-2xl leading-snug text-champagne">
              {f.title}
            </h3>
          </article>
        ))}
      </div>
    </section>
  );
}
