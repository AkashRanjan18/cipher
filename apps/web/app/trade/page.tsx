import { fetchCandles } from "@/lib/market";
import { Terminal } from "@/components/trade/terminal";

/**
 * The terminal. One market — SOL/USDT.
 *
 * A SERVER component, so the first candles are fetched here and the page
 * arrives already drawn. Fetching them in the browser would show an empty
 * chart on every load while a request went out and came back.
 *
 * Deliberately NOT gated on authentication. Reading a chart costs nothing
 * and commits nothing; gating it behind a login is exactly the friction this
 * product exists to remove. Auth is required to ARM an order, which is where
 * something real happens.
 */
export default async function Trade() {
  const candles = await fetchCandles("1h", 1000);

  return <Terminal initial={candles} initialInterval="1h" />;
}
