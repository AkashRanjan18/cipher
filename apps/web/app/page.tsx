import { LoginButton } from "@/components/auth/login-button";

export default function Home() {
  return (
    <main className="relative h-dvh w-full overflow-hidden">
      {/*
        BACKGROUND
        Drop the footage at public/hero.mp4 and a first-frame still at
        public/hero-poster.jpg. Until then the gradient below shows through
        and the page still looks deliberate rather than broken.

        muted + playsInline are both required or iOS refuses to autoplay.
        The poster covers the gap before the video buffers, and is what
        reduced-motion users see instead of the loop.
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

      {/* Fallback ground. Sits behind the video, visible while it loads and
          permanently if the file is missing. */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-neutral-900 via-ink to-black" />

      {/*
        SCRIM
        Video is busy and its brightness changes frame to frame. Without this
        the wordmark becomes unreadable every time someone in a light coat
        walks through the middle of the shot. Darker at the edges so the
        header and footer text hold too.
      */}
      <div className="absolute inset-0 bg-gradient-to-b from-ink/70 via-ink/40 to-ink/80" />

      {/* HEADER — absolute so the video runs full-bleed underneath it */}
      <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-end p-6 sm:p-8">
        <LoginButton />
      </header>

      {/* WORDMARK */}
      <div className="relative z-10 flex h-full flex-col items-center justify-center px-6">
        <h1 className="font-display text-[clamp(4rem,18vw,14rem)] font-extralight leading-none tracking-[0.08em] text-champagne">
          cipher
        </h1>

        <p className="mt-6 font-sans text-sm tracking-[0.25em] text-champagne/60 uppercase">
          From thought to trade
        </p>
      </div>
    </main>
  );
}
