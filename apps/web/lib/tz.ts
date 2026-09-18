/**
 * Time zones, without shipping a database of them.
 *
 * The chart draws its axis in a chosen zone and the header names that zone,
 * so both need the same answer to "how far ahead of UTC is this, right now".
 * Putting it in one file is the same rule the palette follows: two copies of
 * a number drift, and a chart labelled +5:30 while its bars are shifted by
 * +5:00 is a lie that looks like a rendering bug.
 */

/**
 * Minutes a zone is ahead of UTC AT THIS MOMENT — daylight saving included.
 *
 * Formatting one instant in the zone and in UTC and subtracting is the only
 * way to get this from the platform. `en-US` with an explicit numeric format
 * so the parse is not at the mercy of a locale that writes the day first.
 *
 * This is why the menu's offsets are computed rather than typed: a hardcoded
 * "(UTC-8) Los Angeles" is wrong for eight months of the year.
 */
export function offsetMinutes(zone: string): number {
  if (zone === "UTC") return 0;
  const now = new Date();
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(now);
  const parse = (v: string) => {
    const [d, t] = v.split(", ");
    const [M, D, Y] = d.split("/").map(Number);
    const [h, m, sec] = t.split(":").map(Number);
    /* hour12:false renders midnight as 24 in some engines. */
    return Date.UTC(Y, M - 1, D, h === 24 ? 0 : h, m, sec);
  };
  try {
    return Math.round((parse(fmt(zone)) - parse(fmt("UTC"))) / 60000);
  } catch {
    /* An unknown zone must not take the chart down with it. */
    return 0;
  }
}

/** "+5:30", "−8", "+0" for UTC itself. */
export function offsetLabel(mins: number): string {
  const sign = mins < 0 ? "−" : "+";
  const h = Math.floor(Math.abs(mins) / 60);
  const m = Math.abs(mins) % 60;
  return `${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}

/** The browser's own zone, or UTC when it will not say. */
export function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
