import type { Candle, Interval } from "./types";

/**
 * SOL/USDT candles from Binance. Free, keyless, and complete.
 *
 * Chosen over an on-chain aggregator for one reason: every interval returns
 * 1000 unbroken bars with no duplicates and no gaps, back to 2020 on weekly,
 * and rapid calls are not rate limited. GeckoTerminal's free tier 429s after
 * TWO concurrent requests, which is what left charts empty and rendered as
 * "no price history for this pool".
 *
 * cipher: this is a centralised price for one major, not a Solana pool price.
 * It is here to make the chart correct while the on-chain data path is built.
 * When Geyser lands, only this file is replaced — nothing above it changes.
 */

const REST = "https://api.binance.com/api/v3/klines";
const STREAM = "wss://stream.binance.com:9443/ws";

/**
 * The market the terminal opens on.
 *
 * Still a default, no longer the only one — every function below now takes a
 * symbol. The left panel is a navigator, and a navigator cannot exist while
 * the pair is baked into the fetch.
 */
export const SYMBOL = "SOLUSDT";

/** Bar length in seconds, so the chart can bucket "now" correctly. */
const SECONDS: Record<Interval, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
};

export function intervalSeconds(interval: Interval): number {
  return SECONDS[interval];
}

export function isInterval(v: string): v is Interval {
  return v in SECONDS;
}

export const INTERVAL_ORDER: Interval[] = ["1m", "5m", "15m", "1h", "4h", "1d"];

/** Binance kline: [openTime, open, high, low, close, volume, closeTime, …] */
type Kline = [number, string, string, string, string, string, ...unknown[]];

export async function fetchCandles(
  interval: Interval = "1h",
  limit = 1000,
  symbol: string = SYMBOL,
): Promise<Candle[]> {
  const res = await fetch(
    `${REST}?symbol=${symbol}&interval=${interval}&limit=${limit}`,
    {
      headers: { Accept: "application/json" },
      // Half a bar. Revalidating faster re-fetches a candle that has not
      // changed; slower leaves the forming bar visibly stale.
      next: { revalidate: Math.max(10, Math.floor(SECONDS[interval] / 2)) },
    },
  );
  if (!res.ok) throw new Error(`Binance ${res.status}`);

  const rows = (await res.json()) as Kline[];

  /*
   * Binance returns ascending with no repeats, unlike the on-chain
   * aggregators. The dedupe is kept anyway because lightweight-charts throws
   * on a duplicate timestamp and takes the whole page down with it — a cheap
   * guard against a crash that is not recoverable in the UI.
   */
  const byTime = new Map<number, Candle>();
  for (const [t, o, h, l, c, v] of rows) {
    byTime.set(t / 1000, {
      time: t / 1000, // ms → seconds. Charts render blank if you skip this.
      open: +o,
      high: +h,
      low: +l,
      close: +c,
      volume: +v,
    });
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

interface KlineMessage {
  k: { t: number; o: string; h: string; l: string; c: string; v: string };
}

/**
 * Live bars over a websocket — pushed, not polled.
 *
 * This is what makes a chart feel alive. Polling moves the last bar in steps
 * as fast as the interval; a stream moves it on every trade.
 *
 * Returns an unsubscribe that MUST stop the reconnect loop, or the socket
 * resurrects itself after the component unmounts and writes into a destroyed
 * chart.
 */
export function subscribeCandles(
  interval: Interval,
  onCandle: (c: Candle) => void,
  symbol: string = SYMBOL,
): () => void {
  let socket: WebSocket | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let backoff = 500;

  const connect = () => {
    if (stopped) return;
    socket = new WebSocket(
      `${STREAM}/${symbol.toLowerCase()}@kline_${interval}`,
    );

    socket.onopen = () => {
      backoff = 500; // reset only once a connection actually succeeds
    };

    socket.onmessage = (event) => {
      const { k } = JSON.parse(event.data) as KlineMessage;
      onCandle({
        time: k.t / 1000,
        open: +k.o,
        high: +k.h,
        low: +k.l,
        close: +k.c,
        volume: +k.v,
      });
    };

    // A dropped socket looks identical to a frozen market. Always reconnect,
    // backing off so a Binance outage is not hammered.
    socket.onclose = () => {
      if (stopped) return;
      retry = setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 15000);
    };
  };

  connect();

  return () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    socket?.close();
  };
}
