import { fetchTrending, fetchNewPools } from "@/lib/market";
import { DiscoverGrid } from "@/components/trade/discover-grid";

/**
 * The discovery home at /trade — what a signed-in user lands on.
 *
 * A SERVER component: both lists are fetched here so the page arrives
 * populated, with no spinner and no client waterfall.
 *
 * Deliberately NOT gated on authentication. Browsing tokens and reading
 * their safety data costs nothing and commits nothing; gating it behind a
 * login is exactly the friction this product exists to remove. Auth is
 * required to ARM an order, which is where something real happens.
 */
export default async function Discover() {
  /*
   * Allowed to fail without taking the page down — the grid renders an
   * explicit "rate limited" state rather than an empty market.
   */
  const rail = await Promise.all([fetchTrending(), fetchNewPools()]).catch(
    () => null,
  );

  return (
    <main className="mx-auto flex min-h-dvh max-w-7xl flex-col gap-8 px-6 py-10">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-3xl lowercase text-champagne">
          what are you trading
        </h1>
        <p className="font-sans text-sm text-ash">
          Pick a token, or say what you want in a sentence.
        </p>
      </div>

      <DiscoverGrid
        trending={rail?.[0] ?? []}
        fresh={rail?.[1] ?? []}
        unavailable={rail === null}
      />
    </main>
  );
}
