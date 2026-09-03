import { notFound } from "next/navigation";
import {
  fetchTokenStats,
  fetchCandles,
  fetchTrades,
  fetchTrending,
  fetchNewPools,
  fetchSecurity,
  fetchMajors,
} from "@/lib/market";
import { TopBar } from "@/components/shell/top-bar";
import { TickerBar } from "@/components/shell/ticker-bar";
import { TokenHeader } from "@/components/trade/token-header";
import { LivePrice } from "@/components/trade/live-price";
import { ChartPanel } from "@/components/trade/chart-panel";
import { SidePanel } from "@/components/trade/side-panel";
import { TokenRail } from "@/components/trade/token-rail";
import { TradePanel } from "@/components/trade/trade-panel";
import { AboutCard } from "@/components/trade/about-card";
import { PromptPanel } from "@/components/trade/prompt-panel";

/**
 * The terminal.
 *
 * A SERVER component. Every fetch runs here, so the page arrives with prices,
 * candles, the tape, the rail and the safety report already in the HTML — no
 * spinner, no client waterfall, and the upstream APIs never see the user's IP.
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
   * The rail and the ticker are independent of the token, so they start
   * immediately rather than waiting on the stats call the rest needs.
   *
   * They are also allowed to fail. Discovery is a convenience; the token you
   * asked for is the page. A rate-limited sidebar must not take the chart
   * down with it.
   */
  const railP = Promise.all([
    fetchTrending(),
    fetchNewPools(),
    fetchMajors(),
  ]).catch(() => null);

  const stats = await fetchTokenStats(mint);
  if (!stats) notFound();

  /*
   * These key off the pair address the stats call chose, so they cannot start
   * until it resolves — but they are independent of each other.
   */
  const [rail, candles, trades, security] = await Promise.all([
    railP,
    fetchCandles(stats.pairAddress, "1h", 300),
    fetchTrades(stats.pairAddress),
    // An absent safety panel says "unverified"; it is never a pass.
    fetchSecurity(mint).catch(() => null),
  ]);

  return (
    /*
     * h-dvh with overflow-hidden, not a scrolling page. A terminal's panes
     * scroll independently inside a fixed frame — if the whole document
     * scrolls, the tape pushes the chart off screen as trades arrive.
     */
    <div className="flex h-dvh flex-col overflow-hidden bg-ink">
      <TopBar />

      <LivePrice initial={stats}>
        <header className="shrink-0 border-b border-champagne/10 px-4 py-2.5">
          <TokenHeader socials={stats.socials} />
        </header>

        {/* Rail, chart, side panel, order entry. Stacks on a phone, where a
            four-pane terminal is unusable anyway. */}
        <main className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-y-auto p-2 lg:grid-cols-[200px_1fr_280px_320px] lg:overflow-hidden">
          <div className="order-2 min-h-[280px] lg:order-none lg:min-h-0">
            <TokenRail
              majors={rail?.[2] ?? []}
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

          {/* The only column that scrolls on its own — order entry, the About
              card and the prompt readback stack taller than the viewport. */}
          <div className="order-4 flex flex-col gap-3 lg:order-none lg:overflow-y-auto">
            <TradePanel token={stats.symbol} />
            <AboutCard trades={trades} />
            <PromptPanel />
          </div>
        </main>
      </LivePrice>

      <TickerBar majors={rail?.[2] ?? []} />
    </div>
  );
}
