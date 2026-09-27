/**
 * The terminal's backgrounds.
 *
 * DRAWN, NOT DOWNLOADED. Every one of these is CSS gradients or a few lines
 * of SVG written here, so they are free in the only sense that matters for a
 * product: nobody else owns them. A photo pulled from a "free wallpapers" site
 * comes with a licence somebody has to read, a file somebody has to host, and
 * a megabyte on every page load. These cost nothing to ship and stay sharp on
 * a 4K monitor, because there are no pixels in them to run out of.
 *
 * DARK, ON PURPOSE. The panels go translucent over a wallpaper, so whatever is
 * behind the numbers has to stay behind them. Anything bright enough to be
 * interesting on its own would be bright enough to fight a P&L for attention.
 *
 * cipher: these carry their own hex values, which is what CLAUDE.md warns
 * against for the palette. They are images, not tokens — nothing reads a
 * colour back out of them — so the one-home rule does not apply to them.
 */

export interface Wallpaper {
  id: string;
  name: string;
  /** A CSS `background` value. Null is cipher's own plain ground. */
  css: string | null;
}

/** SVG as a CSS url(). Encoded here so the markup above stays readable. */
function svg(markup: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(markup)}")`;
}

const DUNES = svg(
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1600 900' preserveAspectRatio='xMidYMax slice'>` +
    `<rect width='1600' height='900' fill='#07080c'/>` +
    `<path d='M0 520 C 300 440 520 600 820 520 S 1300 430 1600 500 V900 H0Z' fill='#141833'/>` +
    `<path d='M0 630 C 260 560 560 700 860 630 S 1320 560 1600 620 V900 H0Z' fill='#1c2146'/>` +
    `<path d='M0 740 C 320 680 600 800 900 740 S 1360 690 1600 730 V900 H0Z' fill='#262c5a'/>` +
    `</svg>`,
);

const CONTOURS = svg(
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'>` +
    `<g fill='none' stroke='#2a3050' stroke-width='1.4'>` +
    `<path d='M-20 80 C 80 40 160 120 260 80 S 380 40 420 70'/>` +
    `<path d='M-20 140 C 90 100 170 180 270 140 S 390 100 420 130'/>` +
    `<path d='M-20 200 C 100 160 180 240 280 200 S 400 160 420 190'/>` +
    `<path d='M-20 260 C 80 220 170 300 260 260 S 380 220 420 250'/>` +
    `<path d='M-20 320 C 90 280 160 360 270 320 S 390 280 420 310'/>` +
    `</g></svg>`,
);

export const WALLPAPERS: Wallpaper[] = [
  { id: "none", name: "Plain", css: null },
  {
    id: "aurora",
    name: "Aurora",
    css:
      "radial-gradient(ellipse 80% 60% at 15% 10%, rgba(38,166,154,0.5), transparent 60%)," +
      "radial-gradient(ellipse 70% 55% at 85% 20%, rgba(99,76,201,0.54), transparent 60%)," +
      "radial-gradient(ellipse 90% 70% at 50% 110%, rgba(26,82,118,0.6), transparent 65%)," +
      "#05060a",
  },
  {
    id: "ember",
    name: "Ember",
    css:
      "radial-gradient(ellipse 90% 60% at 50% 115%, rgba(226,120,40,0.6), transparent 60%)," +
      "radial-gradient(ellipse 50% 40% at 90% 100%, rgba(255,98,46,0.36), transparent 65%)," +
      "linear-gradient(180deg, #06070a 0%, #0d0907 100%)",
  },
  {
    id: "deep-sea",
    name: "Deep sea",
    css:
      "radial-gradient(ellipse 70% 50% at 50% 0%, rgba(40,90,160,0.54), transparent 70%)," +
      "linear-gradient(180deg, #081020 0%, #05070d 60%, #030409 100%)",
  },
  {
    id: "sol",
    name: "Sol",
    css:
      "radial-gradient(ellipse 60% 50% at 0% 100%, rgba(153,69,255,0.58), transparent 65%)," +
      "radial-gradient(ellipse 60% 50% at 100% 0%, rgba(20,241,149,0.32), transparent 65%)," +
      "#06060b",
  },
  {
    id: "nebula",
    name: "Nebula",
    css:
      "radial-gradient(circle at 25% 30%, rgba(190,60,160,0.4), transparent 40%)," +
      "radial-gradient(circle at 70% 65%, rgba(60,90,220,0.43), transparent 45%)," +
      "radial-gradient(circle at 55% 20%, rgba(120,60,200,0.29), transparent 35%)," +
      "#050509",
  },
  {
    id: "grid",
    name: "Grid",
    css:
      "linear-gradient(rgba(81,106,246,0.1) 1px, transparent 1px) 0 0 / 32px 32px," +
      "linear-gradient(90deg, rgba(81,106,246,0.1) 1px, transparent 1px) 0 0 / 32px 32px," +
      "radial-gradient(ellipse 70% 60% at 50% 40%, rgba(81,106,246,0.22), transparent 70%)," +
      "#05060a",
  },
  { id: "dunes", name: "Dunes", css: `${DUNES} center bottom / cover no-repeat, #07080c` },
  { id: "contours", name: "Contours", css: `${CONTOURS} 0 0 / 400px 400px, #07080a` },
];

export const DEFAULT_WALLPAPER = "none";

/** An id from storage may be from an older build, or typed by hand. */
export function wallpaperById(id: string | null | undefined): Wallpaper {
  return WALLPAPERS.find((w) => w.id === id) ?? WALLPAPERS[0];
}
