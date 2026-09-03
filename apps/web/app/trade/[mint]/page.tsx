import { notFound } from "next/navigation";
import { fetchTokenStats, fetchCandles, fetchTrades } from "@/lib/market";
import { TokenHeader } from "@/components/trade/token-header";
import { ChartPanel } from "@/components/trade/chart-panel";
import { TradeTape } from "@/components/trade/trade-tape";
import { TradePanel } from "@/components/trade/trade-panel";
import { PromptPanel } from "@/components/trade/prompt-panel";

/**
 * The terminal.
 *
 * A SERVER component. Every fetch runs here, so the page arrives with prices,
 * candles and the tape already in the HTML — no spinner, no client waterfall,
 * and the upstream APIs never see the user's IP.
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
   * Candles and tape both key off the pair address the stats call chose, so
   * they cannot start until it resolves — but they are independent of each
   * other, so they run together. Sequencing them would add a round trip to
   * every page load for nothing.
   */
  const [candles, trades] = await Promise.all([
    fetchCandles(stats.pairAddress, "1h", 300),
    fetchTrades(stats.pairAddress),
  ]);

  return (
    /*
     * h-dvh with overflow-hidden, not a scrolling page. A terminal's panes
     * scroll independently inside a fixed frame — if the whole document
     * scrolls, the tape pushes the chart off screen as trades arrive.
     */
    <main className="flex h-dvh flex-col overflow-hidden bg-ink">
      <header className="shrink-0 border-b border-champagne/10 px-4 py-3">
        <TokenHeader stats={stats} />
      </header>

      {/* Chart left, tape and order entry right. Stacks on a phone, where a
          four-pane terminal is unusable anyway. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-y-auto p-2 lg:grid-cols-[1fr_300px_340px] lg:overflow-hidden">
        <div className="min-h-[380px] lg:min-h-0">
          <ChartPanel
            pair={stats.pairAddress}
            initial={candles}
            initialInterval="1h"
          />
        </div>

        <div className="min-h-[300px] lg:min-h-0">
          <TradeTape pair={stats.pairAddress} initial={trades} />
        </div>

        {/* Order entry is the only column that scrolls on its own — the
            prompt panel grows as the readback fills in. */}
        <div className="flex flex-col gap-3 lg:overflow-y-auto">
          <TradePanel token={stats.symbol} />
          <PromptPanel />
        </div>
      </div>
    </main>
  );
}
