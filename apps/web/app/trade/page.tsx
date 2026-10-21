import { candlesFor } from "@/lib/chain/candles";
import { SOL_MINT } from "@/lib/chain/markets";
import { Terminal } from "@/components/trade/terminal";

/**
 * The terminal. Opens on SOL — the Solana market, not the Binance pair.
 *
 * A SERVER component, so the first candles are fetched here and the page
 * arrives already drawn. Fetching them in the browser would show an empty
 * chart on every load while a request went out and came back.
 *
 * THE MINT, NOT "SOLUSDT", and the difference was visible on screen. Opening
 * on the Binance pair meant the chart header showed Binance's SOL price while
 * the market list two inches to the left showed Jupiter's — $101.04 against
 * $100.98, for the same coin, at the same moment. Both were correct; they are
 * different venues. But the row a user clicks and the header they read have to
 * be the same market, and the market cipher actually trades is the Solana one.
 *
 * Deliberately NOT gated on authentication. Reading a chart costs nothing and
 * commits nothing; gating it behind a login is exactly the friction this
 * product exists to remove. Auth is required to ARM an order, which is where
 * something real happens.
 */
/**
 * NEVER CACHED, BECAUSE THE PAYLOAD IS A PRICE SERIES.
 *
 * Every fetch in this page carries `revalidate: 20`, which made Next treat
 * the PAGE as revalidating too — so /trade went into the full route cache and
 * was served stale-while-revalidate. On a site with steady traffic that is
 * invisible. On this one it meant the first visitor after a quiet spell got
 * the copy rendered at the last deploy: measured on 21 Oct 2026, a page whose
 * newest candle was 18 Oct 17:00 — seventy-four hours of missing bars, with a
 * live price label floating six dollars above a dead series.
 *
 * A chart that is a few seconds behind is a chart. A chart that is three days
 * behind is a picture of a chart, and nothing on screen says which one you are
 * looking at. The inner fetch keeps its 20-second data cache, so this costs
 * one render per request and at most one upstream call per twenty seconds.
 */
export const dynamic = "force-dynamic";

export default async function Trade() {
  /*
   * Empty rather than throwing if GeckoTerminal is unreachable or rate
   * limited. The client refetches on mount, so the cost of a failure here is
   * a chart that arrives a beat late — not a page that does not arrive.
   */
  const candles = await candlesFor(SOL_MINT, "1h").catch(() => []);

  return <Terminal initial={candles} initialInterval="1h" initialSymbol={SOL_MINT} />;
}
