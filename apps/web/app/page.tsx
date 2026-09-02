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

        {/* Fallback ground, visible until the video lands. */}
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-[#1a1424] via-ink to-black" />

        {/* Scrim — video brightness swings frame to frame, and without this
            the wordmark vanishes whenever something bright crosses centre. */}
        <div className="absolute inset-0 bg-gradient-to-b from-ink/60 via-ink/35 to-ink" />

        <header className="relative z-10 flex items-center justify-between p-6 sm:p-8">
          <span className="font-display text-2xl lowercase">cipher</span>
          <AuthButton variant="ghost" label="Log in" labelAuthenticated="Enter" />
        </header>

        <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 pb-24 text-center">
          {/* Caacupé One has one weight — never add font-light or font-bold
              here, the browser will fake it and it looks wrong. */}
          <h1 className="font-display text-[clamp(4.5rem,17vw,12rem)] leading-none text-champagne">
            cipher
          </h1>

          <p className="mt-6 font-display text-3xl leading-tight sm:text-5xl">
            from thoughts to trade.
          </p>

          <p className="mt-5 max-w-lg font-sans text-base text-ash sm:text-lg">
            Type what you want. We&rsquo;ll handle the rest — and so will your
            friends.
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

      {/* ── SHOW IT ───────────────────────────────────────────────────── */}
      <section className="px-6 py-24 sm:py-32">
        <h2 className="mb-14 text-center font-display text-4xl leading-tight sm:text-5xl">
          trading, but you just ask.
        </h2>
        <Readback />
      </section>

      {/* ── FEATURES ──────────────────────────────────────────────────── */}
      <Features />

      {/* ── CLOSE ─────────────────────────────────────────────────────── */}
      <section className="px-6 py-24 text-center sm:py-32">
        <h2 className="mx-auto max-w-2xl font-display text-4xl leading-tight sm:text-6xl">
          you already know what you want.
        </h2>
        <p className="mt-5 font-sans text-base text-ash">
          Say it once. We&rsquo;ll take it from there.
        </p>

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
          <span className="font-display text-lg lowercase text-ash">cipher</span>
          <p className="font-sans text-xs text-ash">
            Not available to US persons. Trading involves risk of total loss.
          </p>
        </div>
      </footer>
    </>
  );
}
