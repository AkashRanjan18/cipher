import { notFound } from "next/navigation";
import {
  fetchTokenStats,
  fetchCandles,
  fetchTrades,
  fetchTrending,
  fetchNewPools,
  fetchSecurity,
} from "@/lib/market";
import { TokenHeader } from "@/components/trade/token-header";
import { LivePrice } from "@/components/trade/live-price";
import { ChartPanel } from "@/components/trade/chart-panel";
import { SidePanel } from "@/components/trade/side-panel";
import { TokenRail } from "@/components/trade/token-rail";
import { TradePanel } from "@/components/trade/trade-panel";
import { PromptPanel } from "@/components/trade/prompt-panel";

/**
 * The terminal.
 *
 * A SERVER component. Every fetch runs here, so the page arrives with prices,
 * candles, the tape and the rail already in the HTML — no spinner, no client
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

  /*
   * The rail is independent of the token, so it starts immediately rather
   * than waiting on the stats call the rest of the page needs.
   *
   * It is also allowed to fail. Discovery is a convenience; the token you
   * asked for is the page. A rate-limited rail must not take the chart down
   * with it, so the rejection is caught here and reported to the panel.
   */
  const railP = Promise.all([fetchTrending(), fetchNewPools()]).catch(
    () => null,
  );

  const stats = await fetchTokenStats(mint);
  if (!stats) notFound();

  /*
   * Candles and tape both key off the pair address the stats call chose, so
   * they cannot start until it resolves — but they are independent of each
   * other, so they run together.
   */
  const [rail, candles, trades, security] = await Promise.all([
    railP,
    fetchCandles(stats.pairAddress, "1h", 300),
    fetchTrades(stats.pairAddress),
    /*
     * Safety is allowed to fail without taking the page down. An absent panel
     * says "unverified"; it must never be rendered as a pass.
     */
    fetchSecurity(mint).catch(() => null),
  ]);

  return (
    /*
     * h-dvh with overflow-hidden, not a scrolling page. A terminal's panes
     * scroll independently inside a fixed frame — if the whole document
     * scrolls, the tape pushes the chart off screen as trades arrive.
     */
    <main className="flex h-dvh flex-col overflow-hidden bg-ink">
      {/*
        One poll for the whole terminal. The header and the chart both need a
        live price; polling separately would double the upstream cost for the
        same number, against a rate limit shared by every user.

        Children pass straight through, so the panes below stay server-rendered.
      */}
      <LivePrice initial={stats}>
      <header className="shrink-0 border-b border-champagne/10 px-4 py-3">
        <TokenHeader />
      </header>

      {/* Rail, chart, tape, order entry. Stacks on a phone, where a four-pane
          terminal is unusable anyway. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-y-auto p-2 lg:grid-cols-[210px_1fr_290px_330px] lg:overflow-hidden">
        <div className="order-2 min-h-[280px] lg:order-none lg:min-h-0">
          <TokenRail
            trending={rail?.[0] ?? []}
            fresh={rail?.[1] ?? []}
            unavailable={rail === null}
          />
        </div>

        <div className="order-1 min-h-[380px] lg:order-none lg:min-h-0">
          <ChartPanel
            pair={stats.pairAddress}
            initial={candles}
            initialInterval="1h"
          />
        </div>

        <div className="order-3 min-h-[300px] lg:order-none lg:min-h-0">
          <SidePanel
            pair={stats.pairAddress}
            trades={trades}
            security={security}
            socials={stats.socials}
          />
        </div>

        {/* Order entry is the only column that scrolls on its own — the
            prompt panel grows as the readback fills in. */}
        <div className="order-4 flex flex-col gap-3 lg:order-none lg:overflow-y-auto">
          <TradePanel token={stats.symbol} />
          <PromptPanel />
        </div>
      </div>
      </LivePrice>
    </main>
  );
}
