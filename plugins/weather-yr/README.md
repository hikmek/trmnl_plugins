# Plugin #1 - Weather (yr.no)

TRMNL private plugin (Polling strategy) showing current conditions, today's
high/low, and a 5-day forecast for **Alsjön (Alsjö kärrväg 7, Lerum, Sweden)**.

- Data source: [MET Norway Locationforecast 2.0](https://api.met.no/weatherapi/locationforecast/2.0/documentation) (yr.no), free, no API key required.
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
    "temperature": 14.2,
    "condition_code": "partlycloudy_day",
    "condition_text": "Partly cloudy",
    "icon": "partly-cloudy",
    "icon_url": "https://hikmek.github.io/trmnl_plugins/weather-yr/icons/partly-cloudy.png",
    "wind_speed": 3.1,
    "humidity": 78,
    "precipitation_next_hour": 0.0
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

## Pixel-art weather icons

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
