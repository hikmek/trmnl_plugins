# Plugin #1 - Weather (yr.no + SMHI + Open-Meteo)

TRMNL private plugin (Polling strategy) showing current conditions, today's
high/low, and a 5-day forecast for **Alsjön (Alsjö kärrväg 7, Lerum, Sweden)**.

The displayed `current.temperature` is the **average of three independent
sources** for the same coordinates, so a single source having a bad reading
(or being briefly down) doesn't skew the number shown - see "Multi-source
temperature" below.

- Primary source (icon/condition/wind/humidity/forecast): [MET Norway Locationforecast 2.0](https://api.met.no/weatherapi/locationforecast/2.0/documentation) (yr.no), free, no API key required.
- Additional temperature sources: [SMHI Open Data](https://opendata.smhi.se/apidocs/metfcst/get-forecast.html) and [Open-Meteo](https://open-meteo.com/) (both free, no API key).
- Coordinates: lat `57.8626`, lon `12.3025`.

## How it works

1. `.github/workflows/build-pages.yml` runs `fetch.mjs` on every workflow
   run (as often as every 5 min, though GitHub Actions schedules are often
   delayed several minutes in practice). `fetch.mjs` self-throttles via
   `lib/throttle.mjs`: it checks the currently-published data.json's own
   age and skips the actual yr.no fetch if it's less than ~25 minutes old,
   so real-world updates land close to every 30 min regardless of exactly
   when GitHub happens to run the workflow.
2. `fetch.mjs` calls the yr.no API, aggregates the forecast into a small JSON
   file, and writes it to `public/weather-yr/data.json`.
3. The workflow publishes the `public/` folder to **GitHub Pages**.
4. Your real TRMNL device (Private Plugin, **Polling** strategy) fetches that
   JSON URL on its own refresh schedule and renders it using
   `template.liquid`.

## One-time setup

1. **Enable GitHub Pages**: repo → Settings → Pages → Source = "GitHub
   Actions". (No branch/folder to pick - the workflow handles it.)
2. Push to `main` (or run the workflow manually via Actions tab →
   "Build and deploy plugin data to GitHub Pages" → Run workflow).
3. Confirm the JSON is live at:
   `https://hikmek.github.io/trmnl_plugins/weather-yr/data.json`
4. On [usetrmnl.com](https://usetrmnl.com), create a new **Private Plugin**:
   - Strategy: **Polling**
   - Polling URL: the URL from step 3
   - Polling Verb: `GET`
   - Refresh rate: 30-60 min (matches the workflow's cadence)
   - Markup: paste the contents of `template.liquid`
5. Add an instance of the plugin to your playlist/screen.

## Data schema (`data.json`)

```jsonc
{
  "plugin": "weather-yr",
  "generated_at": "2026-09-07T18:00:00.000Z",
  "updated_display": "Data uppdaterad kl 21:59 idag", // shows the date instead of "idag" if not generated today (Europe/Stockholm)
  "location": { "name": "...", "municipality": "...", "lat": 57.8626, "lon": 12.3025 },
  "current": {
    "temperature": 14.2,           // average of temperature_sources below
    "temperature_sources": { "yr.no": 14.5, "smhi": 13.9, "open-meteo": 14.2 }, // whichever of the 3 succeeded this run
    "condition_code": "partlycloudy_day",
    "condition_text": "Partly cloudy",
    "icon": "partly-cloudy",           // bucket name only - no variant number
    "icon_url": "https://hikmek.github.io/trmnl_plugins/weather-yr/icons/partly-cloudy-2.png", // random variant (1-3) picked this run
    "wind_speed": 3.1,
    "humidity": 78,
    "precipitation_next_hour": 0.0,
    "clothing_icon": "tshirt-jacket",  // picked from the averaged temperature, see CLOTHING_BANDS in fetch.mjs
    "clothing_icon_url": "https://hikmek.github.io/trmnl_plugins/weather-yr/icons/clothing-tshirt-jacket-1.png", // random variant (1-3)
    "clothing_text": "T-shirt & tunn jacka",
    "needs_rain_gear": false,          // true if rain/sleet/thunder is indicated now or in the next hour
    "rain_gear_icon_url": "https://hikmek.github.io/trmnl_plugins/weather-yr/icons/clothing-umbrella-3.png", // random variant (1-3)
    "needs_wind_gear": false,          // true if wind_speed >= WIND_GEAR_THRESHOLD_MS (8 m/s), regardless of temperature
    "wind_gear_icon_url": "https://hikmek.github.io/trmnl_plugins/weather-yr/icons/clothing-windbreaker-1.png", // random variant (1-3)
    "rain_starts_at": null,            // set only when NOT currently raining: ISO time of the first upcoming rain within 60 min, else null
    "rain_period_started_at": null,    // set only while CURRENTLY raining: ISO time this rain period began (carried across runs), else null
    "rain_period_ends_at": null,       // set only while CURRENTLY raining: ISO time it's expected to stop (within 12h), else null
    "rain_forecast_text": "Inget regn i sikte närmaste 60 min!" // or "Det börjar regna kl 19:30 idag!" or "Lätt regn kl 18:04–20:00" or "Lätt regn sedan kl 18:04"
  },
  "today": { "high": 16.5, "low": 9.8 },
  "forecast": [
    {
      "date": "2026-09-07",
      "day_name": "Today",
      "high": 16.5,
      "low": 9.8,
      "condition_code": "partlycloudy_day",
      "condition_text": "Partly cloudy",
      "icon": "partly-cloudy",
      "icon_url": "https://hikmek.github.io/trmnl_plugins/weather-yr/icons/partly-cloudy-3.png", // random variant (1-3)
      "precipitation_mm": 0.4
    }
    // ...4 more days
  ]
}
```

## Multi-source temperature

`current.temperature` is the average of up to three independent readings
for the same coordinates, fetched in `fetch.mjs`:

1. **yr.no** - already fetched for everything else (icon, wind, humidity,
   forecast); its `air_temperature` reading is always included.
2. **SMHI** (`fetchSmhiTemperature()`) - SMHI's old `pmp3g` point-forecast
   API (the one almost every SMHI tutorial/integration online still
   references) was **deprecated on 2026-03-31**. This uses their
   replacement `snow1g` API instead, with a defensive fallback parse for
   the old `pmp3g` response shape in case some cached/alternate endpoint
   still returns it.
3. **Open-Meteo** (`fetchOpenMeteoTemperature()`) - used as the third
   source instead of klart.se, which has no documented public API (it's a
   consumer app/site, not a developer platform).

Each of the two extra sources is independently non-fatal (same pattern as
lunch-lerum's hemmamat fetch): if SMHI or Open-Meteo fails or times out,
it's simply left out of the average rather than blocking the plugin - only
a yr.no failure is fatal (it's also the source for everything else).
`current.temperature_sources` records whichever readings were actually
obtained that run, for transparency/debugging.

## Pixelated clothing proposal

Alongside the weather icon, `current.clothing_icon_url` (and, when
conditions call for it, `current.rain_gear_icon_url` and/or
`current.wind_gear_icon_url`) point at pixel-art clothing icons generated
by `generate-clothing-icons.mjs` (same 32x32-grid / nearest-neighbor-
upscale technique as the weather icons, see "Pixel-art weather icons"
below - each item has 3 variants, randomly picked on every fetch run) -
`icons/clothing-<slug>-<variant>.png`.

`fetch.mjs`'s `CLOTHING_BANDS` picks one outfit from the averaged
`current.temperature` - 8 bands now (was 5), for finer-grained
recommendations across the full range from very hot to extreme cold:

| Temperature | Icon slug | Text |
| --- | --- | --- |
| ≥ 25°C | `tank-top` | Linne & shorts |
| 20–24.9°C | `shorts-tshirt` | T-shirt & shorts |
| 15–19.9°C | `tshirt-jacket` | T-shirt & tunn jacka |
| 8–14.9°C | `light-jacket` | Lätt jacka |
| 3–7.9°C | `jacket` | Jacka |
| -5–2.9°C | `warm-jacket` | Varm jacka & mössa |
| -15– -5.1°C | `winter-coat` | Vinterjacka, mössa & vantar |
| < -15°C | `extreme-cold` | Tjock vinterjacka, mössa, scarf & vantar |

(Each slug above maps to `clothing-<slug>-1.png` / `-2.png` / `-3.png` -
`clothingIconUrl()` picks one of the three at random each run.)

Separately, two more gear icons can appear alongside the outfit icon,
regardless of temperature:

- `expectsRain()` checks yr.no's next-hour precipitation amount and its
  condition symbol (rain/sleet/thunder) - if either indicates rain,
  `current.needs_rain_gear` is `true` and an umbrella icon
  (`clothing-umbrella-<variant>.png`) is shown.
- `needsWindGear()` checks `current.wind_speed` against
  `WIND_GEAR_THRESHOLD_MS` (8 m/s, roughly Beaufort 5 "fresh breeze") - if
  it's windy enough, `current.needs_wind_gear` is `true` and a windbreaker
  icon (`clothing-windbreaker-<variant>.png`) is shown.

So up to three icons can appear together: the outfit icon plus either or
both of the rain/wind gear icons.

`template.liquid` (Full view) puts the weather icon on its own, centered
row at the very TOP of the card (144px - bigger than everything else, so
it reads as the headline element), with the temperature (`value--xxlarge`)
and condition text stacked directly beneath it. The clothing/rain/wind
icons moved down to their own centered row at the very BOTTOM of the card
(80px each, since up to three can appear side by side), followed by the
clothing text and rain-forecast text. This is a deliberate change from an
earlier layout that put the weather icon, temperature, and clothing icons
all side by side in one hero row - that got cramped once a third
(wind-gear) icon could join the rain-gear icon next to the outfit icon.

`template.quadrant.liquid` does **not** use that same top/bottom split -
see the "Quadrant icon+text overflow" note below for why, and what it does
instead (all icons - weather + clothing + optional rain/wind gear -
stacked together in one icon-only row, temperature alone on its own row).

## Rain forecast text

Below the icon/temperature area, `current.rain_forecast_text` gives a
plain-language heads-up, shown centered in both Full and Quadrant views.
It's one of three mutually-exclusive messages, chosen in `fetch.mjs`
specifically so it can never contradict `current.condition_text` (see the
"no rain in sight while it's raining" note below for why that mattered):

1. **Raining right now** (`current.needs_rain_gear` is `true`) - reports
   the *current* rain period's start and, if known, end time:
   `"Lätt regn kl 18:04–20:00"`, or `"Lätt regn sedan kl 18:04"` if
   `findRainEnd()` can't find a dry entry within the next 12 hours yet.
   `current.rain_period_started_at` / `current.rain_period_ends_at` hold
   the raw ISO timestamps (`rain_period_ends_at` is `null` in the
   "sedan kl" case).
2. **Not raining now, but starting soon** - `findRainStart()` scans
   yr.no's near-term timeseries for the first entry, within the next 60
   minutes, where `expectsRain()` is true. If found: `"Det börjar regna kl
   HH:MM idag!"`. `current.rain_starts_at` has the raw ISO timestamp.
3. **Not raining, none expected within 60 min** - `"Inget regn i sikte
   närmaste 60 min!"` (explicitly scoped to the 60-minute window it
   actually checked, rather than an unqualified "no rain in sight" claim).

**Where the start time for case 1 comes from**: yr.no's forecast timeseries
only ever contains "now-or-later" entries, so a single fetch can never know
when an *already-happening* shower actually started. `fetchPreviousRainState()`
works around this by reading back the previously-published `data.json`: if
it was already raining last run and had a `rain_period_started_at`, that
timestamp carries forward unchanged across runs; otherwise "now" is
recorded as the (approximate, accurate to within one fetch interval - see
`MIN_INTERVAL_MINUTES`) start of a newly-detected rain period. This is
best-effort - if that fetch fails, the period is just treated as having
started now.

**The "Lätt regn" / "Inget regn i sikte!" contradiction bug**: the
original `findRainStart()`-only logic always ran, even while it was
already raining - and since it only looks at entries strictly *after* the
current moment, a shower already in progress but expected to taper off
before the next hourly entry would make `findRainStart()` return `null`,
producing "Inget regn i sikte!" (or before this fix, the unqualified
"Inget regn i sikte!") right alongside `condition_text: "Lätt regn"`. The
fix is case 1 above: whenever it's *currently* raining, the message is
built from the current period's start/end instead of ever calling
`findRainStart()`.

**Quadrant icon+text overflow (the real cause of the garbled-temperature /
missing-icon bug)**: a Quadrant mashup pane is only ~1/4 of the screen, and
TRMNL centers a row's content - so a row wider than the pane gets clipped
equally on both edges instead of wrapping. Putting an `<img>` on the same
row as the temperature (`icon - value--base - icon`) made that row too
wide, which silently deleted the icons at both ends *and* chopped up the
temperature digits in the middle - it looked like a corrupt PNG or a
font-size bug, but it was plain horizontal clipping (proved by the
condition/H-L/rain-forecast text rows underneath, which are plain stacked
text with no icon sharing the row, and always rendered perfectly). An
earlier commit (`35fb824`) had already hit and fixed this exact issue once
by switching the icon to sit *above* the temperature instead of beside it;
a later redesign reintroduced the row layout and broke it again. The rule
going forward: in `template.quadrant.liquid`, never put an `<img>` on the
same row as the temperature value - icons may only share a row with other
icons (which are narrow enough to fit), never with `value`/text content.

A different fix that was tried and did *not* actually resolve this
particular symptom, kept here so it isn't re-tried: removing the custom
inline `font-size` in favor of a real `value--*` class - still the right
thing to do (TRMNL renders "value" numbers through its own pixel/bitmap
font system tied to those specific classes), but not the cause of the
Quadrant clipping bug.

**All icons invisible in BOTH Full and Quadrant views (the real "1-bit PNG"
bug)**: separately from the overflow bug above, none of this plugin's
icons (weather or clothing) ever rendered *at all* - not clipped, not a
broken-image glyph, just silently absent, in every view, at every size.
The cause: `generate-icons.mjs` and `generate-clothing-icons.mjs` both
produced 1-bit indexed/palette PNGs (`sharp`'s `.png({ palette: true,
colors: 2 })`, `file` reports "1-bit colormap"). An earlier attempt
mis-diagnosed this as a 1-bit-*grayscale*-vs-1-bit-*palette* mismatch and
"fixed" it by re-encoding grayscale PNGs to palette format - that didn't
help, because the real problem is TRMNL's rendering pipeline apparently
can't display 1-bit PNGs *of either kind*. This was only found by
comparing against `plugins/broforce`'s portrait images, which use plain
`sharp().png()` with no palette reduction (`file` reports "8-bit/color
RGB") and have always rendered correctly on the same TRMNL account -
proving 8-bit RGB is the actually-required format. Fix: both generator
scripts now build a 3-channel raw buffer and emit plain 8-bit RGB PNGs
(no `palette`/`colors` options at all), matching broforce's proven-good
format; the existing `icons/*.png` files were re-encoded in place the same
way. If you ever add new icons here, generate them the same way (or run
`node plugins/weather-yr/generate-icons.mjs` /
`generate-clothing-icons.mjs`) and double check with `file icons/*.png`
that they say "8-bit/color RGB", not "1-bit colormap" or "1-bit grayscale".

**Icon URL cache-busting**: even after the 1-bit PNG files were fixed and
redeployed, some icon URLs (particularly the "current condition" ones hit
on every single render) kept showing the old broken image, while other,
less-frequently-hit ones picked up the fix immediately - some layer
between GitHub Pages and the rendered device was caching image bytes by
URL. Since icon filenames never change run to run, `iconUrl()` /
`clothingIconUrl()` / `rain_gear_icon_url` now append `?v=<short commit
SHA>` (from `GITHUB_SHA`, set automatically in GitHub Actions; falls back
to today's date outside CI) so the URL itself changes whenever the icon
files might have, forcing a fresh fetch instead of serving a stale cached
copy.

**Missing `image--contain image-dither` classes**: even with correct 8-bit
PNGs and cache-busted URLs, weather-yr's icons kept rendering as a generic
placeholder glyph (a small blob, the same shape regardless of which icon
file was actually requested) in every view. Both templates' `<img>` tags
only ever used `class="image"`. Comparing against `plugins/broforce`,
whose custom-generated portrait images are the one confirmed-working
example of this pattern on the same TRMNL account, its `<img>` tags use
`class="image image--contain image-dither"` - TRMNL's framework docs
describe `image-dither` as "essential" for images on 1-bit e-ink displays,
and `image--contain` as the aspect-ratio-preserving sizing mode. Both
weather-yr templates now use the same three classes on every icon `<img>`.
If you add a new icon `<img>` anywhere in this plugin, always include all
three classes, not just `image`.

**Multiple `<img>` tags sharing a flex row**: adding those classes still
wasn't enough - the icons kept rendering as the exact same placeholder
blob regardless of how many were supposed to show (1, 2, or 3, depending
on `needs_rain_gear`). Looking across every image in this whole repo that
has ever actually rendered correctly (broforce's portrait, banksy's
picture, this plugin's own forecast-table icon), each one is always a
*single* `<img>` with no other `<img>` sitting next to it as a flex
sibling. The hero row was the one place with up to three `<img>` tags
side by side inside `<div class="layout layout--row">` elements. Both
templates now lay out the icons as cells of a plain `<table>` instead - one
`<img>` per `<td>`, matching the forecast table's proven-working structure
- rather than flex siblings. (Full view's weather icon table has since
moved to its own single-cell row at the top, separate from the
temperature/text below it - see "Pixelated clothing proposal" above for
the current top/bottom split.)

Icon sizes are chosen to read clearly at a glance rather than as an exact
pixel-for-pixel match with the neighboring text: the Full view's weather
icon is now the single biggest element on the card (144px) since it's on
its own row; its clothing/rain/wind icons are 80px; the Quadrant view's
icons stay smaller (44px) to leave room for the temperature and text below
them in that narrow pane. The temperature values keep a real TRMNL
`value--*` class (`value--xxlarge` / `value--base`) rather than a custom
inline font-size in every case - an arbitrary font-size outside TRMNL's
own pixel/bitmap-font size set corrupted the digits in earlier testing.

To tweak the clothing shapes, edit `generate-clothing-icons.mjs` and
re-run:

```powershell
node plugins/weather-yr/generate-clothing-icons.mjs
```

## Pixel-art weather icons

`generate-icons.mjs` procedurally draws all of weather-yr's condition icons
onto a 32x32 boolean grid (bumped up from 16x16 - "less coarse", finer
pixel-art detail at the same final 128px PNG size) - no external images, no
licensing concerns. There are 7 condition buckets (`sun`, `partly-cloudy`,
`cloudy`, `fog`, `rain`, `snow`, `thunder`), and each bucket now has **3
variants** (`icons/sun-1.png` / `sun-2.png` / `sun-3.png`, etc. - 21 PNGs
total) with genuinely different silhouettes (different ray counts on the
sun, different cloud puffiness, different rain/snow/lightning styles) so
the same condition doesn't always render as the exact same icon.

`fetch.mjs` maps every yr.no `symbol_code` (e.g.
`lightrainshowersandthunder_day`) to one of these 7 buckets via
`iconForCode()`; `iconUrl()` then appends a random variant number
(`ICON_VARIANT_COUNT = 3`, `randomVariant()`) picked fresh on every fetch
run, so refreshing the plugin can show a different-looking (but same-
meaning) icon each time - "more icons to randomize from." `icon` (bucket
name only, no variant) + `icon_url` (full URL, with variant) are set on
both `current` and each `forecast` day. `template.liquid` shows the icon
on its own big centered row at the top of the card, and in the 5-day
forecast table.

The clothing/rain/wind gear icons (`generate-clothing-icons.mjs`) follow
the exact same pattern - 32x32 grid, 3 variants per item
(`clothing-<slug>-1.png` etc., 30 PNGs total for the 8 outfit bands +
umbrella + windbreaker), picked via `clothingIconUrl()`'s own
`randomVariant()` call - see "Pixelated clothing proposal" above.

**Lesson learned while adding variants**: a variant that only adds a small
accent (a stripe, a pocket) drawn *inside* an already-solid silhouette
renders identically to the base variant - the added pixels were already
black. Confirmed by diffing rendered PNGs (`ImageChops.difference` in
Python) after the first draft, which caught several variant pairs with
*zero* pixel difference (e.g. all 3 `warm-jacket` variants were completely
identical). Every variant now changes the silhouette itself instead -
longer/shorter sleeves or hemlines, a wider collar cutout, an accessory
that extends past the base shape's own edge - so the difference is
structurally guaranteed to be visible rather than hidden inside solid fill.
If you add a new variant, verify it the same way (diff the rendered PNGs,
don't just eyeball the drawing code) rather than assuming a pixel-diff of
zero means "the code has a variant check" is enough.

To tweak or add variants, edit the shape functions in `generate-icons.mjs`
/ `generate-clothing-icons.mjs` and re-run (`sharp` is required - if it's
unavailable in your environment, produce PNGs via an equivalent PIL script
using the exact same grid math, as this repo's own history has done):

```powershell
node plugins/weather-yr/generate-icons.mjs
node plugins/weather-yr/generate-clothing-icons.mjs
```

## Language: Swedish only

All display text is Swedish: `symbol_map.json` maps every yr.no condition
code to a Swedish description (e.g. `partlycloudy_day` → "Halvklart"),
`day_name` uses Swedish weekday abbreviations (`sv-SE` locale, "Idag" for
today), and every hardcoded label in `template.liquid`/
`template.quadrant.liquid` (Vind, Luftfuktighet, Dag, Väder, Hög, Låg,
etc.) is Swedish. There's no language toggle - if you ever want English
back, the English originals are in git history for `symbol_map.json` and
the templates.

(See "Pixel-art weather icons" above for how `generate-icons.mjs` itself
works - these are static PNGs committed to git and copied into
`public/weather-yr/icons/` by the shared workflow, same pattern as the
banksy plugin's gallery.)

## Font: smooth Inter, not the pixel font

TRMNL renders pixel fonts (NicoClean/TRMNL16 etc.) by default on
low-density e-ink devices. Normally, forcing the smooth Inter font instead
requires a **device-wide** "Text Scale" setting (`screen--text-scale-*`,
applied to the outer `.screen` element) - but private plugins don't
control that wrapper. Instead, `template.liquid` and
`template.quadrant.liquid` set `font-family: 'Inter', sans-serif` directly
via inline `style` on their top-level containers, which cascades to all
child text and overrides the pixel font - **scoped to just this plugin**,
without changing any device-wide setting or affecting other plugins (e.g.
bus-grabo, which intentionally keeps the pixel font).

## Local test

```powershell
node plugins/weather-yr/fetch.mjs
```

This writes `public/weather-yr/data.json` relative to the repo root and
prints it to the console.

## Notes / possible improvements

- `template.liquid` is a starting point - TRMNL's Private Plugin editor has a
  live preview once you connect the Polling URL; tweak classes/layout there
  using the [TRMNL Framework docs](https://usetrmnl.com/framework).
- Symbol-to-text mapping lives in `symbol_map.json`; extend it if you see
  `condition_text` values falling back to a raw code with underscores.
- MET Norway asks clients to identify themselves via `User-Agent` (see
  `fetch.mjs`) and not to poll faster than the data actually updates
  (~hourly) - the ~30 min effective cadence is comfortably within fair use.
