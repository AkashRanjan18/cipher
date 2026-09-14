import { NextResponse } from "next/server";
import { fetchCandles, isInterval, isMarket, SYMBOL } from "@/lib/market";
import { candlesFor, RateLimited } from "@/lib/chain/candles";
import { looksLikeMint } from "@/lib/chain/tokens";

/**
 * Candles for one market, from whichever venue actually has them.
 *
 * TWO SOURCES, chosen by what the symbol IS rather than by a flag:
 *
 *   a mint          GeckoTerminal, per-pool OHLCV. This is the whole Solana
 *                   universe — every memecoin, every graduated launch, every
 *                   token no exchange will ever list.
 *   a Binance pair  Binance klines. Fourteen majors with long clean history.
 *
 * The split is temporary and the direction of travel is one-way: once the
 * ledger holds more than one asset, the Binance list stops being the trading
 * universe and becomes what it always was — a nicer history for nine coins
 * that also happen to exist on Solana.
 *
 * Both branches validate before interpolating. Either value lands in an
 * upstream URL, and an unchecked one turns this route into an open proxy.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const interval = params.get("interval") ?? "1h";
  const symbol = params.get("symbol") ?? SYMBOL;

  if (!isInterval(interval)) {
    return NextResponse.json({ error: "bad interval" }, { status: 400 });
  }

  if (looksLikeMint(symbol)) {
    try {
      const candles = await candlesFor(symbol, interval);
      /*
       * An empty series is a 200, not an error.
       *
       * A token minted a minute ago genuinely has no candles yet, and that is
       * not a failure of anything — the chart should say "no history yet"
       * rather than "something went wrong", because only one of those is true
       * and they lead the user to different actions.
       */
      return NextResponse.json({ candles });
    } catch (e) {
      /*
       * 429 is not 502, and the difference matters to the person looking at
       * it. GeckoTerminal's free tier is thirty requests a minute across the
       * whole deployment and a cold chart costs two, so opening several new
       * tokens quickly hits it. "Too many charts at once" is recoverable by
       * waiting; "unavailable" reads as the token being broken.
       */
      if (e instanceof RateLimited) {
        return NextResponse.json(
          { error: "too many charts at once — try again in a moment", kind: "rateLimited" },
          { status: 429 },
        );
      }
      console.error("[cipher] solana candles failed:", e);
      return NextResponse.json({ error: "upstream unavailable" }, { status: 502 });
    }
  }

  if (!isMarket(symbol)) {
    return NextResponse.json({ error: "unknown market" }, { status: 400 });
  }

  try {
    return NextResponse.json({ candles: await fetchCandles(interval, 1000, symbol) });
  } catch {
    return NextResponse.json({ error: "upstream unavailable" }, { status: 502 });
  }
}
