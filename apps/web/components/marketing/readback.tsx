/**
 * The single visual that explains what cipher is.
 *
 * Everything else on the page is a claim; this is the claim demonstrated —
 * one sentence of English on top, the compiled order underneath. If a
 * visitor reads nothing else, this block should tell them what the product
 * does and why it isn't another buy button.
 *
 * Server component. No state, no interactivity — just typography.
 */

const compiled = [
  { k: "BUY", v: "$500 BONK", note: null },
  { k: "SLIPPAGE", v: "max 3%", note: "aborts above" },
  { k: "ROUTE", v: "private submission", note: "no sandwich" },
  { k: "THEN", v: "sell 33% at 2×", note: null },
  { k: "STOP", v: "remainder at −50%", note: "depth-checked" },
];

export function Readback() {
  return (
    <div className="mx-auto w-full max-w-2xl">
      {/* What the user types. Quoted and in the reading face, so it reads as
          human speech rather than as configuration. */}
      <p className="font-sans text-lg leading-relaxed text-champagne/90 sm:text-xl">
        <span className="text-ash">“</span>
        buy $500 of BONK, max 3% slippage, private, sell a third at 2×, stop
        the rest at −50%
        <span className="text-ash">”</span>
      </p>

      <div className="my-7 flex items-center gap-4" aria-hidden>
        <div className="h-px flex-1 bg-champagne/15" />
        <span className="font-mono text-[10px] tracking-[0.3em] text-ash">
          COMPILES TO
        </span>
        <div className="h-px flex-1 bg-champagne/15" />
      </div>

      {/* What the machine will actually do. Monospace and tabular, because
          this is the contract the user approves before anything arms — it
          has to read as precise, not as prose. */}
      <dl className="rounded-lg border border-champagne/12 bg-slate p-5 font-mono text-sm sm:p-6">
        {compiled.map((row) => (
          <div
            key={row.k}
            className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-1.5"
          >
            <dt className="w-24 shrink-0 text-[11px] tracking-[0.15em] text-ash">
              {row.k}
            </dt>
            <dd className="text-champagne tabular-nums">{row.v}</dd>
            {row.note && (
              <dd className="text-xs text-ash">— {row.note}</dd>
            )}
          </div>
        ))}
      </dl>

      <p className="mt-5 text-center font-sans text-sm text-ash">
        You approve this once. It runs whether or not you are watching.
      </p>
    </div>
  );
}
