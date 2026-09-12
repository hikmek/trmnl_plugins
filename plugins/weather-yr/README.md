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
    "icon": "partly-cloudy",
    "icon_url": "https://hikmek.github.io/trmnl_plugins/weather-yr/icons/partly-cloudy.png",
    "wind_speed": 3.1,
    "humidity": 78,
    "precipitation_next_hour": 0.0,
    "clothing_icon": "tshirt-jacket",  // picked from the averaged temperature, see CLOTHING_BANDS in fetch.mjs
    "clothing_icon_url": "https://hikmek.github.io/trmnl_plugins/weather-yr/icons/clothing-tshirt-jacket.png",
    "clothing_text": "T-shirt & tunn jacka",
    "needs_rain_gear": false,          // true if rain/sleet/thunder is indicated now or in the next hour
    "rain_gear_icon_url": "https://hikmek.github.io/trmnl_plugins/weather-yr/icons/clothing-umbrella.png",
    "rain_starts_at": null,            // ISO timestamp of the first upcoming rain within 60 min, or null
    "rain_forecast_text": "Inget regn i sikte!" // or "Det börjar regna kl 19:30 idag!"
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
      "icon_url": "https://hikmek.github.io/trmnl_plugins/weather-yr/icons/partly-cloudy.png",
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

Alongside the weather icon, `current.clothing_icon_url` (and, when rain is
expected, `current.rain_gear_icon_url`) point at pixel-art clothing icons
generated by `generate-clothing-icons.mjs` (same 16x16-grid /
nearest-neighbor-upscale technique as the weather icons, see below) -
`icons/clothing-*.png`.

`fetch.mjs`'s `CLOTHING_BANDS` picks one outfit from the averaged
`current.temperature`:

| Temperature | Icon | Text |
| --- | --- | --- |
| ≥ 20°C | `clothing-shorts-tshirt.png` | T-shirt & shorts |
| 12–19.9°C | `clothing-tshirt-jacket.png` | T-shirt & tunn jacka |
| 5–11.9°C | `clothing-jacket.png` | Jacka |
| 0–4.9°C | `clothing-warm-jacket.png` | Varm jacka & mössa |
| < 0°C | `clothing-winter-coat.png` | Vinterjacka, mössa & vantar |

Separately, `expectsRain()` checks yr.no's next-hour precipitation amount
and its condition symbol (rain/sleet/thunder) - if either indicates rain,
`current.needs_rain_gear` is `true` and an umbrella icon
(`clothing-umbrella.png`) is shown alongside the outfit icon, regardless of
temperature.

`template.liquid` (Full view) lays these out as weather icon (left, 96px) -
temperature (center, `value--xxlarge`) - clothing + rain-gear icons
(right, 96px). `template.quadrant.liquid` uses the same left/center/right
idea at a smaller size (36px icons, `value--base`), but only shows the
outfit icon (no separate rain-gear icon - there's only room for one icon
on the right in that small a pane).

## Rain forecast text

Below the icon/temperature row, `current.rain_forecast_text` gives a
plain-language heads-up: `findRainStart()` in `fetch.mjs` scans yr.no's
near-term hourly timeseries entries (the same `expectsRain()` check used
for the rain-gear icon) for the first one, within the next 60 minutes,
that indicates rain. If one is found, the text is `"Det börjar regna kl
HH:MM idag!"` using that entry's local time; otherwise it's `"Inget regn i
sikte!"`. `current.rain_starts_at` has the raw ISO timestamp (or `null`)
if you want to use it separately. Shown centered in both Full and
Quadrant views.

**Note on the clothing icon PNGs**: they must be saved as 1-bit
**palette/indexed** PNGs (`colorType 3`), matching the existing weather
icons exactly - a 1-bit **grayscale** PNG (`colorType 0`, which is what a
naive `Pillow` `mode "1"` save produces) is a different, valid PNG variant
that TRMNL's rendering pipeline apparently can't decode: it silently drops
the image AND corrupts the neighboring text in the same row, rather than
just showing a broken-image icon. If you regenerate the clothing icons
outside of `generate-clothing-icons.mjs` (which uses `sharp` and produces
the correct palette format automatically), re-encode with something like
`Image.open(path).convert("L").convert("P", palette=Image.ADAPTIVE,
colors=2)` before saving, and check with `file icons/*.png` that it says
"1-bit colormap", not "1-bit grayscale".

**Important**: the temperature keeps a real TRMNL `value--*` class rather
than a custom inline `font-size`. TRMNL renders "value" numbers through
its own pixel/bitmap font system tied to those specific classes - an
arbitrary font-size outside that set was tried first to force an exact
icon/text height match, but it corrupted the digits *and* broke the
neighboring icons' rendering (a whole-row artifact, not just a text one).
The icon sizes above are just chosen to visually balance against
`value--xxlarge` / `value--base` (per the repo's own size notes:
`value--large` ≈ 58px, `value--xlarge` ≈ 74px) rather than an exact
pixel-for-pixel match with the text.

To tweak the clothing shapes, edit `generate-clothing-icons.mjs` and
re-run:

```powershell
node plugins/weather-yr/generate-clothing-icons.mjs
```

## Pixel-art weather icons

## Language: Swedish only

All display text is Swedish: `symbol_map.json` maps every yr.no condition
code to a Swedish description (e.g. `partlycloudy_day` → "Halvklart"),
`day_name` uses Swedish weekday abbreviations (`sv-SE` locale, "Idag" for
today), and every hardcoded label in `template.liquid`/
`template.quadrant.liquid` (Vind, Luftfuktighet, Dag, Väder, Hög, Låg,
etc.) is Swedish. There's no language toggle - if you ever want English
back, the English originals are in git history for `symbol_map.json` and
the templates.

`generate-icons.mjs` procedurally draws 7 small black/white pixel-art icons
(no external images, no licensing concerns) into `icons/*.png`:
`sun`, `partly-cloudy`, `cloudy`, `fog`, `rain`, `snow`, `thunder`. These
are static assets committed to git and copied into `public/weather-yr/icons/`
by the shared workflow (same pattern as the banksy plugin's gallery).

`fetch.mjs` maps every yr.no `symbol_code` (e.g.
`lightrainshowersandthunder_day`) to one of these 7 buckets via
`iconForCode()`, and adds `icon` (bucket name) + `icon_url` (full URL) to
both `current` and each `forecast` day. `template.liquid` shows the icon
next to the temperature value and in the 5-day forecast table.

To tweak the icon shapes, edit the shape functions in `generate-icons.mjs`
and re-run:

```powershell
node plugins/weather-yr/generate-icons.mjs
```

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
