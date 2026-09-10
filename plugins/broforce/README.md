# Plugin #5 - Broforce: Bro of the Day

TRMNL private plugin (Polling strategy) showing one random BROFORCE
character portrait, picked fresh once a day, with the Bro's name
underneath.

- Data source: none - fully static, pre-generated assets, no network calls,
  no API key.
- 42 Bros in the roster (the base game roster plus The Expendabros DLC
  characters).

## How it works

1. `generate-portraits.mjs` (rare - run manually, NOT part of the recurring
   workflow) crops each individual Bro portrait out of the reference sheets
   in `sources/` (each sheet is a screenshot compiling several portraits +
   printed names) and nearest-neighbour upscales every crop to a common
   200px height, writing `portraits/<slug>.png` + `portraits/manifest.json`
   (slug, name, description, file). The printed name text in the source
   screenshots is discarded - the plugin renders the name itself as a real
   label, so it's legible in TRMNL's own pixel font instead of a tiny
   anti-aliased screenshot font.
2. `.github/workflows/build-pages.yml` runs `fetch.mjs` every 5 minutes
   (same shared workflow as the other plugins), but `fetch.mjs` itself only
   actually picks a new Bro once per Europe/Stockholm calendar day (see
   "Calendar-day throttle" below) - cheap enough to run every cycle since
   there's no external request involved.
3. `fetch.mjs` writes `public/broforce/data.json` pointing at today's
   chosen portrait.
4. GitHub Pages publishes it (and the portrait images) at:
   `https://hikmek.github.io/trmnl_plugins/broforce/data.json`
5. Your TRMNL device (Private Plugin, Polling strategy) fetches that JSON
   and renders it with `template.liquid`.

## Calendar-day throttle

Uses the same `shouldSkipDailyFetch` helper as lunch-lerum: it checks the
`date` field of the already-published `data.json` against today's date (in
Europe/Stockholm) and skips picking a new Bro if they match. This means a
new Bro is picked promptly after midnight regardless of exactly when the
5-minute workflow happens to run, and the same Bro is shown consistently
all day.

## Setting up the TRMNL Private Plugin

On [usetrmnl.com](https://usetrmnl.com), create another **Private Plugin**:

- Strategy: **Polling**
- Polling URL: `https://hikmek.github.io/trmnl_plugins/broforce/data.json`
- Polling Verb: `GET`
- Refresh rate: 30-60 min is plenty (the underlying data only changes once
  a day)
- Markup: paste the contents of `template.liquid` (and `template.quadrant.liquid`
  into the Quadrant tab, if you use this in a Mashup)

## Data schema (`data.json`)

```jsonc
{
  "plugin": "broforce",
  "generated_at": "2026-09-10T19:03:00.000Z",
  "date": "2026-09-10", // Europe/Stockholm calendar date this Bro was picked for
  "updated_display": "Data uppdaterad kl 21:03 idag",
  "bro": {
    "slug": "brominator",
    "name": "Brominator",
    "description": "T-800 from the Terminator franchise",
    "image_url": "https://hikmek.github.io/trmnl_plugins/broforce/portraits/brominator.png"
  },
  "roster_size": 42
}
```

## Regenerating the portraits

Only needed if you add/replace a reference sheet in `sources/` or tweak a
crop box:

```powershell
node plugins/broforce/generate-portraits.mjs
```

The crop box for every Bro is hardcoded in the `BROS` table at the top of
that script (`[sheet, [x0,y0,x1,y1], slug, name, description]`) - re-crop by
editing the box for that entry and re-running.

## Known limitations / maintenance

- A few of the later portraits (the Expendabros ones, from `sources/4.png`
  onward) carry a small square "DLC" badge overlay in the bottom-right
  corner baked into the source screenshot - left as-is rather than
  inpainted out, since it's a minor cosmetic artifact on a personal display.
- Portrait art is cropped from BROFORCE (Free Lives / Devolver Digital)
  reference screenshots, used here purely for a personal, non-commercial
  e-ink display - not redistributed as a product.
- Adding a 43rd Bro later: crop a new reference sheet the same way, add its
  entry to `BROS` in `generate-portraits.mjs`, re-run it, done - `fetch.mjs`
  automatically picks from however many entries are in `manifest.json`.
