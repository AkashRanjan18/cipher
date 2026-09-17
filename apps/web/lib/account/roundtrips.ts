import { CRUMB_USD, DUST, type Fill } from "./paper.ts";

/**
 * CLOSED POSITIONS, recovered from the fills.
 *
 * The ledger keeps open positions in `account.positions` and deletes the row
 * the moment one goes flat — deliberately, so nothing iterating holdings walks
 * a list of every coin ever touched. That is right for the ledger and it means
 * a closed position exists nowhere: the only surviving evidence is the fills,
 * and "what did I make on that trade" has to be reconstructed from them.
 *
 * A ROUND TRIP IS A RUN FROM FLAT TO FLAT. Buying more of something you
 * already hold extends the same trip rather than starting a second one,
 * because the ledger holds one average cost per mint and there is no second
 * position for the second buy to belong to. Selling it all and buying back
 * DOES start a new one — the basis reset, so the next position is measured
 * against a price the last one never saw.
 *
 * REALISED P&L IS SUMMED FROM THE FILLS, never recomputed here. execute()
 * books it per sell against the average cost at that instant, with the buy
 * fee already folded into the basis and the sell fee already out of the
 * proceeds. Re-deriving it from prices and quantities would produce a second
 * number that is nearly the same and disagrees at the cent — and the whole
 * reason this panel exists is to be the answer to "what did that cost me".
 *
 * Pure, and in lib/account rather than in the component, for the same reason
 * paper.ts is: the money math has to be testable without a browser.
 */
export interface RoundTrip {
  mint: string;
  /** Unix seconds of the buy that opened it. */
  openedAt: number;
  /** Unix seconds of the sell that took it flat. */
  closedAt: number;
  /** Units bought over the life of the trip. */
  qtyBought: number;
  /** Units sold. Below `qtyBought` by a crumb when one was written off. */
  qtySold: number;
  /** Cash that went in, fees included — what the cost basis was built from. */
  investedUsd: number;
  /** Cash that came back, net of the fees charged to get out. */
  proceedsUsd: number;
  /** What the ledger booked, summed off the fills. */
  realisedUsd: number;
  /** Commission on both legs. Already inside the two numbers above. */
  feesUsd: number;
  /** Return on the cash committed. Null when nothing went in. */
  returnPct: number | null;
  /** How many fills it took. */
  fills: number;
}

interface Draft {
  mint: string;
  openedAt: number;
  qtyBought: number;
  qtySold: number;
  investedUsd: number;
  proceedsUsd: number;
  realisedUsd: number;
  feesUsd: number;
  fills: number;
  /** Running balance. The thing that decides when the trip is over. */
  held: number;
}

/**
 * Every position that has been opened and closed, oldest first.
 *
 * Oldest first because that is the order the ledger wrote them in; the panel
 * reverses it, the way the swaps table does. A list that is already reversed cannot
 * be usefully sorted any other way without being reversed back.
 */
export function roundTrips(fills: Fill[]): RoundTrip[] {
  const open = new Map<string, Draft>();
  const out: RoundTrip[] = [];

  for (const f of fills) {
    let d = open.get(f.mint);

    if (!d) {
      /* A sell with nothing open cannot come out of this ledger — quote()
         refuses to sell what is not held — so it is skipped rather than used
         to invent a trip with no entry and a hundred percent return. */
      if (f.side === "sell") continue;
      d = {
        mint: f.mint,
        openedAt: f.ts,
        qtyBought: 0,
        qtySold: 0,
        investedUsd: 0,
        proceedsUsd: 0,
        realisedUsd: 0,
        feesUsd: 0,
        fills: 0,
        held: 0,
      };
      open.set(f.mint, d);
    }

    d.fills += 1;
    d.feesUsd += f.feeUsd;
    const notional = f.qty * f.price;

    if (f.side === "buy") {
      d.investedUsd += notional + f.feeUsd;
      d.qtyBought += f.qty;
      d.held += f.qty;
      continue;
    }

    d.proceedsUsd += notional - f.feeUsd;
    d.qtySold += f.qty;
    d.realisedUsd += f.realisedUsd;
    d.held -= f.qty;

    /*
     * THE SAME FLAT TEST execute() APPLIES, and it has to be the same one.
     *
     * Selling in dollars rounds to the cent and converts back, which leaves a
     * few millionths of a token behind. The ledger treats that as flat, books
     * its cost as a realised loss and deletes the row. A stricter test here
     * would leave this trip open forever against a position that no longer
     * exists, and the closed list would silently miss its most recent entry.
     */
    if (d.held < DUST || d.held * f.price < CRUMB_USD) {
      out.push({
        mint: d.mint,
        openedAt: d.openedAt,
        closedAt: f.ts,
        qtyBought: d.qtyBought,
        qtySold: d.qtySold,
        investedUsd: d.investedUsd,
        proceedsUsd: d.proceedsUsd,
        realisedUsd: d.realisedUsd,
        feesUsd: d.feesUsd,
        returnPct: d.investedUsd > 0 ? (d.realisedUsd / d.investedUsd) * 100 : null,
        fills: d.fills,
      });
      open.delete(f.mint);
    }
  }

  return out;
}
