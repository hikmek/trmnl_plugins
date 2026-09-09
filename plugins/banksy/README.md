# Plugin #4 - Banksy Pixel Art

TRMNL private plugin (Polling strategy) that shows a rotating gallery of
Banksy artwork photos, converted into small blocky "pixel art" PNGs. A new
random image is picked **every 5 minutes**.

## How it works (two separate scripts, two very different cadences)

1. **`generate-gallery.mjs`** (rare - run manually, NOT part of the
   recurring workflow):
   - Downloads real photos of Banksy artworks from **Wikimedia Commons**
     (see `sources.json` for the curated list, each with its license and
     photographer attribution - see "Licensing" below).
   - Uses `sharp` to downscale each photo to a small grid (48 "big pixels"
     wide), then upscale with nearest-neighbor to get hard pixel-art
     blocks, then quantizes the color palette (32 colors).
   - Writes the results to `plugins/banksy/gallery/*.png` **and commits
     them to git** - they're static assets, not regenerated on a schedule.
   - Writes `plugins/banksy/gallery/manifest.json` (title/location/license/
     attribution for each image).
   - Is idempotent: re-running it skips any `<id>.png` that already exists,
     so it's cheap to re-run after adding new entries to `sources.json`.

2. **`fetch.mjs`** (frequent - runs every 5 minutes via the shared GitHub
   Actions workflow):
   - Reads `gallery/manifest.json`, picks one entry at **random**.
   - Writes `public/banksy/data.json` pointing at that image's public URL
     (the image itself is just a static file served from GitHub Pages -
     no image processing happens on this frequent schedule).

This split matters: image downloading/processing (network + CPU heavy,
depends on Wikimedia) only ever happens when *you* choose to run it. The
recurring 5-minute job is trivial (read a JSON file, pick a random entry,
write a tiny JSON file) so it's fast, free, and has nothing external to
fail.

## One-time setup

Pages/Actions are already configured for this repo (shared with the other
3 plugins). On [usetrmnl.com](https://usetrmnl.com), create another
**Private Plugin**:

- Strategy: **Polling**
- Polling URL: `https://hikmek.github.io/trmnl_plugins/banksy/data.json`
- Polling Verb: `GET`
- Refresh rate: **5 minutes** (matches the rotation)
- Markup (Full tab): paste `template.liquid`
- Markup (Quadrant tab): paste `template.quadrant.liquid`

## Data schema (`data.json`)

```jsonc
{
  "plugin": "banksy",
  "generated_at": "2026-09-09T03:56:19.875Z",
  "image_url": "https://hikmek.github.io/trmnl_plugins/banksy/gallery/dismaland.png",
  "title": "Dismaland (overview)",
  "location": "Weston-super-Mare, UK",
  "license": "CC BY-SA 4.0",
  "attribution": "M. (via Lommes)",
  "source_page": "https://commons.wikimedia.org/wiki/File:Dismaland_overview_01-02_combined.jpg",
  "gallery_size": 6
}
```

## Growing the gallery

`sources.json` currently has 11 curated entries, but only 6 finished
generating before Wikimedia's anti-abuse rate limiter kicked in
(`429 Too Many Requests`, `Retry-After: 600`) during initial setup - this
is normal if you hit their image servers with many requests in a short
window. To fill in the rest (or add new ones):

```powershell
node plugins/banksy/generate-gallery.mjs
```

It skips anything already in `gallery/`, so it only needs to (re)download
what's missing. If you still get rate-limited, just wait a few minutes and
re-run - it's safe to run as many times as you like.

To add more artworks: add an entry to `sources.json` (needs `id`, `title`,
`location`, `url`, `license`, `attribution`, `source_page`), then re-run
the generator.

## Licensing / attribution

Only images confirmed to be on **Wikimedia Commons under a free license**
(CC0, CC BY, or CC BY-SA) are used - see each entry's `source_page` in
`sources.json` for the original file and full attribution. Photos that
were only available as English Wikipedia "non-free/fair-use" uploads
(e.g. certain iconic prints like "Girl with Balloon") were deliberately
**excluded**, since fair-use images aren't licensed for reuse outside
Wikipedia.

Note the usual caveat with any Banksy photo: the underlying street art
itself may still carry its own copyright/trademark considerations
independent of the photographer's license on Commons. This plugin is a
personal, non-commercial hobby display; it is not legal advice.

`template.liquid` displays the license + photographer attribution in the
title bar to keep this visible on-screen.

## Local test

```powershell
# One-time (or occasional) - generate/refresh the gallery:
node plugins/banksy/generate-gallery.mjs

# Frequent rotator (what the 5-minute cron actually runs):
node plugins/banksy/fetch.mjs
```

## Known limitations / maintenance

- **No "avoid immediate repeat" logic** - each pick is fully random, so
  the same image can occasionally show up twice in a row. With 6-11
  images in the pool this is a minor, acceptable quirk for a fun display.
- **`sharp` is only needed locally/for `generate-gallery.mjs`** - it's a
  `dependency` in the repo's root `package.json`, but the frequent
  `fetch.mjs` script doesn't use it at all, so the recurring GitHub Actions
  workflow never needs `npm install`.
- Pixelation parameters (`PIXEL_GRID_WIDTH`, `OUTPUT_WIDTH`, palette colors)
  are constants at the top of `generate-gallery.mjs` - adjust and re-run
  (delete the specific `gallery/<id>.png` first to force regeneration).
