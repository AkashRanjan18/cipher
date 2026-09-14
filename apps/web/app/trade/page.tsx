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
export default async function Trade() {
  /*
   * Empty rather than throwing if GeckoTerminal is unreachable or rate
   * limited. The client refetches on mount, so the cost of a failure here is
   * a chart that arrives a beat late — not a page that does not arrive.
   */
  const candles = await candlesFor(SOL_MINT, "1h").catch(() => []);

  return <Terminal initial={candles} initialInterval="1h" initialSymbol={SOL_MINT} />;
}
