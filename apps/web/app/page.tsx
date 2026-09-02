import { AuthButton } from "@/components/auth/auth-button";
import { DownloadButton } from "@/components/download-button";
import { Readback } from "@/components/marketing/readback";
import { Features } from "@/components/marketing/features";

export default function Home() {
  return (
    <>
      {/* ── HERO ──────────────────────────────────────────────────────── */}
      <section className="relative flex min-h-dvh flex-col overflow-hidden">
        <video
          className="hero-video absolute inset-0 h-full w-full object-cover"
          autoPlay
          muted
          loop
          playsInline
          poster="/hero-poster.jpg"
        >
          <source src="/hero.mp4" type="video/mp4" />
        </video>

        {/* Fallback ground — visible while the video buffers, and permanently
            if the file is missing, so the page looks deliberate either way. */}
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-neutral-900 via-ink to-black" />

        {/* Scrim. Video brightness changes frame to frame; without this the
            wordmark vanishes when anything bright crosses the middle. */}
        <div className="absolute inset-0 bg-gradient-to-b from-ink/75 via-ink/45 to-ink" />

        <header className="relative z-10 flex items-center justify-between p-6 sm:p-8">
          <span className="tracked-sm font-display text-sm font-light uppercase">
            cipher
          </span>
          <AuthButton variant="ghost" label="Log in" labelAuthenticated="Enter" />
        </header>

        <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 pb-20 text-center">
          {/* Caps and wide-tracked, after Tesla and SpaceX. The .tracked class
              adds a matching indent so the optical centre lands correctly —
              without it, trailing letter-space drags the word left. */}
          <h1 className="tracked font-display text-[clamp(2.75rem,11vw,8rem)] font-extralight uppercase leading-none text-champagne">
            cipher
          </h1>

          <p className="mt-8 font-display text-2xl font-light sm:text-4xl">
            No settings. Just say it.
          </p>

          <p className="mt-4 max-w-xl font-sans text-base text-ash">
            Describe the trade in a sentence. cipher configures it, argues if
            it&rsquo;s a bad idea, and runs it while you&rsquo;re asleep.
          </p>

          <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
            <AuthButton
              variant="primary"
              label="Start trading"
              labelAuthenticated="Open cipher"
            />
            <DownloadButton />
          </div>
        </div>
      </section>

      {/* ── THE DEMONSTRATION ─────────────────────────────────────────── */}
      <section className="border-t border-champagne/10 px-6 py-24 sm:py-32">
        <p className="mb-12 text-center font-mono text-[10px] tracking-[0.3em] text-ash">
          FROM THOUGHTS TO TRADE
        </p>
        <Readback />
      </section>

      {/* ── FEATURES ──────────────────────────────────────────────────── */}
      <div className="border-t border-champagne/10">
        <Features />
      </div>

      {/* ── CLOSE ─────────────────────────────────────────────────────── */}
      <section className="border-t border-champagne/10 px-6 py-24 text-center sm:py-32">
        <h2 className="mx-auto max-w-2xl font-display text-3xl font-light sm:text-5xl">
          You already know what you want.
          <br />
          <span className="text-ash">Stop configuring it.</span>
        </h2>

        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center sm:gap-4">
          <AuthButton
            variant="primary"
            label="Start trading"
            labelAuthenticated="Open cipher"
          />
          <DownloadButton />
        </div>
      </section>

      <footer className="border-t border-champagne/10 px-6 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row">
          <span className="tracked-sm font-display text-xs font-light uppercase text-ash">
            cipher
          </span>
          <p className="font-sans text-xs text-ash">
            Not available to US persons. Trading involves risk of total loss.
          </p>
        </div>
      </footer>
    </>
  );
}
