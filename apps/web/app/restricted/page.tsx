export const metadata = {
  title: "Not available here — cipher",
  robots: { index: false },
};

/**
 * Where middleware.ts sends blocked visitors.
 *
 * The message differs by reason, because the two cases are not the same
 * product decision and telling a US visitor "you cannot trade here" when they
 * can trade spot would lose a user for no reason.
 *
 * `reason` comes from the middleware redirect. It is untrusted — anyone can
 * type it into the URL — so it only selects between fixed copy and is never
 * rendered.
 */
export default async function Restricted({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const derivatives = reason === "us-derivatives";

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 px-6 py-16">
      <p className="font-display text-3xl lowercase text-champagne">cipher</p>

      {derivatives ? (
        <>
          <h1 className="font-display text-4xl leading-tight text-champagne">
            Perps aren&rsquo;t available in the US.
          </h1>
          <p className="font-sans leading-relaxed text-ash">
            Leveraged derivatives need a CFTC-registered venue, and we
            don&rsquo;t hold that registration. Spot trading is unaffected —
            it&rsquo;s non-custodial, you hold your own keys, and you can carry
            on as normal.
          </p>
          <a
            href="/trade"
            className="w-fit rounded-full bg-champagne px-5 py-2.5 font-sans text-sm font-medium text-ink transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-champagne"
          >
            Back to trading
          </a>
        </>
      ) : (
        <>
          <h1 className="font-display text-4xl leading-tight text-champagne">
            Not available in your region.
          </h1>
          <p className="font-sans leading-relaxed text-ash">
            cipher doesn&rsquo;t operate in sanctioned jurisdictions. This
            isn&rsquo;t a temporary outage, and it isn&rsquo;t something we can
            make an exception on.
          </p>
          <a
            href="/"
            className="w-fit rounded-full border border-champagne/25 px-5 py-2.5 font-sans text-sm text-champagne transition-colors hover:border-champagne/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-champagne"
          >
            Back to the homepage
          </a>
        </>
      )}
    </main>
  );
}
