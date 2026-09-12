import { AuthButton } from "@/components/auth/auth-button";
import { DownloadButton } from "@/components/download-button";

export default function Home() {
  return (
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
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-[#171334] via-ink to-black" />

      {/* Scrim — video brightness swings frame to frame, and without this the
          wordmark vanishes whenever something bright crosses centre. */}
      <div className="absolute inset-0 bg-gradient-to-b from-ink/60 via-ink/35 to-ink" />

      <header className="relative z-10 flex items-center justify-between p-6 sm:p-8">
        <span className="font-display text-2xl lowercase">cipher</span>
        <AuthButton variant="ghost" label="Log in" />
      </header>

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 pb-24 text-center">
        {/* Caacupé One has one weight — never add font-light or font-bold
            here, the browser will fake it and it looks wrong. */}
        <h1 className="font-display text-[clamp(4.5rem,17vw,12rem)] leading-none text-champagne">
          cipher
        </h1>

        <p className="mt-6 font-display text-3xl leading-tight sm:text-5xl">
          From thoughts to trade.
        </p>

        <p className="mt-5 max-w-lg font-sans text-base text-ash sm:text-lg">
          Type what you want. We&rsquo;ll handle the rest — and so will your
          friends.
        </p>

        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
          <AuthButton variant="primary" label="Start trading" />
          <DownloadButton />
        </div>
      </div>
    </section>
  );
}
