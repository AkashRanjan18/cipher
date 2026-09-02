# Fonts

Drop the display face here and it gets wired into `--font-display`.

Expected files (any subset — I'll match what's actually here):

    ChampagneLimousines.ttf              regular
    ChampagneLimousines-Bold.ttf         bold      (optional)
    ChampagneLimousines-Italic.ttf       italic    (optional)

Source: https://www.dafont.com/champagne-limousines.font — free for
personal use; check the licence before commercial launch.

`.ttf` and `.otf` both work. Next converts and self-hosts them at build
time, so nothing is fetched from a third party at runtime.

Nothing else in the codebase changes when this lands. Every consumer reads
the `--font-display` CSS variable rather than naming a family, so the swap
is confined to `app/layout.tsx`.
