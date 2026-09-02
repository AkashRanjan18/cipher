import { AuthButton } from "@/components/auth/auth-button";
import { DownloadButton } from "@/components/download-button";

export default function Home() {
  return (
    <main className="relative h-dvh w-full overflow-hidden">
      {/*
        BACKGROUND
        Drop the footage at public/hero.mp4 and a first-frame still at
        public/hero-poster.jpg. Until then the gradient below shows through.

        muted + playsInline are both required or iOS refuses to autoplay,
        and it fails silently — you get a black rectangle with no error.
      */}
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

      {/* Fallback ground: visible while the video buffers, and permanently
          if the file is missing, so the page looks deliberate either way. */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-neutral-900 via-ink to-black" />

      {/* SCRIM. Video brightness changes frame to frame; without this the
          wordmark disappears whenever someone in a light coat walks through
          the middle of the shot. */}
      <div className="absolute inset-0 bg-gradient-to-b from-ink/70 via-ink/40 to-ink/80" />

      {/* HEADER — absolute so the video runs full-bleed underneath */}
      <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-end p-6 sm:p-8">
        <AuthButton variant="ghost" label="Log in" labelAuthenticated="Enter" />
      </header>

      <div className="relative z-10 flex h-full flex-col items-center justify-center px-6">
        <h1 className="font-display text-[clamp(4rem,18vw,14rem)] font-extralight leading-none tracking-[0.08em] text-champagne">
          cipher
        </h1>

        <p className="mt-6 font-sans text-sm uppercase tracking-[0.25em] text-champagne/60">
          From thoughts to trade
        </p>

        {/* Stacked on phones, side by side from 640px. Buttons sitting
            shoulder to shoulder on a narrow screen get thumb-mistapped. */}
        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
          <AuthButton
            variant="primary"
            label="Start trading"
            labelAuthenticated="Open cipher"
          />
          <DownloadButton />
        </div>
      </div>
    </main>
  );
}
