import { notFound } from "next/navigation";
import { fetchTokenStats, fetchCandles } from "@/lib/market";
import { TokenHeader } from "@/components/trade/token-header";
import { PriceChart } from "@/components/trade/price-chart";
import { TradePanel } from "@/components/trade/trade-panel";
import { PromptPanel } from "@/components/trade/prompt-panel";

/**
 * The trading screen for one token.
 *
 * A SERVER component, deliberately. Both fetches run on the server, so the
 * page arrives with prices already in the HTML — no spinner, no client-side
 * waterfall, and the upstream APIs never see the user's IP.
 *
 * The route is /trade/[mint], so a token page is a shareable URL. That is
 * what makes a trade postable, which is the whole growth loop.
 */
export default async function TokenPage({
  params,
}: {
  params: Promise<{ mint: string }>;
}) {
  const { mint } = await params;

  const stats = await fetchTokenStats(mint);
  if (!stats) notFound();

  /*
   * Candles are fetched second because they need the pair address the stats
   * call chose. Charting a different pool from the one the stats came from
   * would show two different prices for the same token on one screen.
   */
  const candles = await fetchCandles(stats.pairAddress, "hour", 300);

  return (
    <main className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-8 px-6 py-10">
      <TokenHeader stats={stats} />

      {/* Chart takes the width it needs; the panels sit beside it on desktop
          and stack underneath on a phone. */}
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <PriceChart candles={candles} />

        <div className="flex flex-col gap-5">
          <TradePanel token={stats.symbol} />

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-champagne/12" />
            <span className="font-mono text-[10px] tracking-[0.25em] text-ash">
              OR JUST SAY IT
            </span>
            <div className="h-px flex-1 bg-champagne/12" />
          </div>

          <PromptPanel />
        </div>
      </div>
    </main>
  );
}
