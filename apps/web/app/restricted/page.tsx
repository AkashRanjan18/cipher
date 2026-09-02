export const metadata = {
  title: "Not available here — cipher",
  robots: { index: false },
};

/**
 * Where middleware.ts sends visitors from restricted jurisdictions.
 *
 * This page must exist for the geoblock to be a control rather than a bug —
 * without it the redirect lands on a 404 and a blocked user is told nothing.
 * It is also the only place the US restriction is now stated, since the
 * landing page footer was removed.
 */
export default function Restricted() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 px-6 py-16">
      <p className="font-display text-3xl lowercase text-champagne">cipher</p>

      <h1 className="font-display text-4xl leading-tight text-champagne">
        Not available in your region.
      </h1>

      <p className="font-sans leading-relaxed text-ash">
        cipher doesn&rsquo;t offer trading to people in the United States or in
        sanctioned jurisdictions. This isn&rsquo;t a temporary outage — we
        don&rsquo;t hold the licences that would let us serve you, and
        we&rsquo;d rather say so plainly than let you sign up and find out
        later.
      </p>

      <a
        href="/"
        className="w-fit rounded-full border border-champagne/25 px-5 py-2.5 font-sans text-sm text-champagne transition-colors hover:border-champagne/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-champagne"
      >
        Back to the homepage
      </a>
    </main>
  );
}
