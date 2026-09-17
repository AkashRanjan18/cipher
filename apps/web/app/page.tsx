import { AuthButton } from "@/components/auth/auth-button";
import { DownloadButton } from "@/components/download-button";
import { SignInHandoff } from "@/components/auth/sign-in-handoff";

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
        * THE STREET, as one file rather than as markup.
        *
        * It is 155KB of SVG — a hundred and fifty buildings, lamps and leaves —
        * and inlining that into the component would put every coordinate into
        * the HTML of a page whose job is to load fast. As an <img> it is a
        * separate, cacheable, gzip-friendly request that the browser can paint
        * independently, and the file stays readable as a file.
        *
        * `alt=""` because it is decoration: the page says what cipher is in
        * words directly underneath, and a screen reader narrating a streetscape
        * would only get in the way of that.
        */}
      <img src="/hero.svg" alt="" className="landing-scene" />
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

        <div className="mt-[38px] flex flex-col items-center gap-3.5 sm:flex-row">
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
