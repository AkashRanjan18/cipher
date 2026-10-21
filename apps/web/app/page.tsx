import { AuthButton } from "@/components/auth/auth-button";
import { DownloadButton } from "@/components/download-button";
import { SignInHandoff } from "@/components/auth/sign-in-handoff";
import { PromptReel } from "@/components/landing/prompt-reel";

/*
 * Reading searchParams makes this route dynamic, which a static marketing page
 * would rather not be.
 *
 * It buys the only thing that removes the flash completely. Google redirects
 * back to "/" carrying the OAuth code, and the browser paints whatever HTML
 * the server sends for that URL — before React hydrates, before Privy has
 * exchanged anything, before any effect can decide to redirect. Hiding the
 * hero on the client is therefore always one paint too late. Deciding here,
 * on the server, means the hero is never sent at all.
 *
 * cipher: the cost is a per-request render of a page with no data in it. If
 * that ever matters, the alternative is a blocking inline script in <head>
 * that sets a data attribute before first paint — same result, more machinery.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ privy_oauth_code?: string; privy_oauth_error?: string }>;
}) {
  const q = await searchParams;

  // A code and no error means the browser is mid-handoff: it left for Google
  // from this page and is passing back through on its way to the terminal.
  // An error means the flow failed, and the way out is the homepage itself.
  if (q.privy_oauth_code && !q.privy_oauth_error) return <SignInHandoff />;

  return (
    <section className="landing relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-6 py-32 text-center">
      {/*
        * React 19 hoists these into <head>, so the landing carries its own
        * typeface without the root layout — and therefore the terminal —
        * paying for a request it never uses.
        */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400..800&display=swap"
      />

      {/*
        * THE HERO IS FOOTAGE AGAIN — dark liquid, moving, silent.
        *
        * It replaced an SVG street, which had replaced an mp4. The objection
        * that retired the first video was real: a clip that has to download
        * before it means anything, on a page whose job is to be understood in
        * one second. `poster` answers it. The browser paints a 16KB jpeg of
        * the first frame immediately, so the page is COMPLETE before any video
        * arrives and the clip only ever replaces something already correct.
        * Nothing below it waits, and a visitor on a bad connection gets a
        * still hero rather than a hole.
        *
        * Why liquid and not a rocket, a city or a chart: the words in front of
        * this have to be readable, and footage with a SUBJECT competes with
        * them. This is near-black with slow highlights — weather rather than
        * subject — and it is the one kind of shot that carries text at any
        * size without a scrim thick enough to make the video pointless.
        *
        * `muted` IS THE CONDITION OF AUTOPLAY, not a courtesy: every browser
        * refuses to start a clip with sound. The audio track is stripped from
        * the file as well, so there is nothing to unmute by accident.
        *
        * `playsInline` stops iOS taking the clip fullscreen the moment it
        * plays, which is what it does by default and which would hand a
        * visitor a video player instead of a homepage.
        *
        * Two cuts. The landscape file is 16:9 and wasted on a phone — cover
        * -fitting it to a tall viewport throws away most of the frame — so a
        * 9:16 crop at 0.8MB serves anything under 768px.
        */}
      <video
        className="landing-scene landing-video"
        poster="/hero/hero-poster.jpg"
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
      >
        <source src="/hero/hero-portrait.mp4" media="(max-width: 767px)" type="video/mp4" />
        <source src="/hero/hero-1920.mp4" type="video/mp4" />
      </video>
      <div className="landing-scrim" />

      <nav className="absolute inset-x-0 top-[clamp(18px,3vh,30px)] z-10 flex items-center justify-between px-[clamp(18px,3.2vw,46px)]">
        <span className="landing-serif text-[30px] font-bold leading-none tracking-[-0.02em] text-white">
          cipher
        </span>
        {/* The real Privy button, not a link. Sizing only, so the header's own
            copy of this button is untouched. */}
        <AuthButton variant="ghost" label="Log in" className="h-11 px-[26px] text-[15px]" />
      </nav>

      <main className="relative z-10 flex flex-col items-center">
        <h1 className="landing-serif landing-wordmark font-bold text-white">cipher</h1>

        <p className="landing-serif landing-tagline mt-[clamp(24px,4vh,46px)] font-medium text-[#fbf6ec]">
          From thoughts to trade.
        </p>

        <p className="landing-sub mt-5 max-w-[540px] font-sans text-[clamp(1rem,2.2vw,19px)] leading-[1.55] text-[#dde5f0]">
          Type what you want. We&rsquo;ll handle the rest — and so will your friends.
        </p>

        {/*
          * THE CLAIM, DEMONSTRATED.
          *
          * Everything above this line is a promise. This is the product: the
          * terminal's own prompt bar, writing orders cipher genuinely takes —
          * a stop, a ladder, a trailing stop, a resting buy, a partial sell.
          * Each of those is four screens of settings on Photon or BullX and
          * one sentence here, which is the entire pitch and is not a pitch
          * anybody believes until they watch it typed.
          *
          * A client component for the typing and nothing else; the page around
          * it stays a server render.
          */}
        <div className="mt-[30px] flex flex-col items-center">
          <PromptReel />
          <p className="mt-3 font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#8d94a5]">
            One sentence. Entry, exits and size together.
          </p>
        </div>

        <div className="mt-[34px] flex flex-col items-center gap-3.5 sm:flex-row">
          <AuthButton
            variant="primary"
            label="Start trading"
            className="h-[52px] px-[34px] text-base font-semibold shadow-[0_18px_44px_rgba(0,0,0,0.5)]"
          />
          <DownloadButton />
        </div>
      </main>
    </section>
  );
}
