# Plugin #6 - Pictures

TRMNL private plugin (Polling strategy) that shows a random picture from
your own PNG files. A new picture is picked **every workflow run** (every
5 minutes), never the same one twice in a row.

## Adding pictures

1. Drop `.png` files into `plugins/pictures/images/`.
2. Commit and push. That's it - there's no manifest to update; the folder
   itself is the list.

The file name becomes the caption: `summer-house_2024.pixel-4bit.png` shows
as "summer house 2024" (a `.pixel-…` suffix is dropped). Files named
`Screenshot …` get no caption; the title bar just says "Bilder". Number-only names like `1.png` get no caption either.

Tips for good results on the e-ink screen:

- **Size:** the TRMNL screen is 800×480. Bigger images work but are just
  scaled down, so resizing first keeps the repo and downloads small.
- **Colors:** the templates are set up for pre-made pixel art (no
  `image-dither`, `image-rendering: pixelated`). For ordinary photos, add
  `image-dither` to the `img` class in both templates instead.
- **Contrast:** high-contrast images look much better on e-ink than soft,
  low-contrast ones.

## Making Game Boy pixel art from your own photos

`generate-pictures.mjs` turns ordinary photos into Game Boy Camera style
pixel art: 160×144 "big pixels", exactly 4 shades, and the Game Boy's
regular checkerboard dither patterns.

1. Put photos (`.jpg`, `.png`, `.webp`, `.tif`) in `plugins/pictures/originals/`.
   This folder is in `.gitignore` - your full-size photos never leave your PC.
2. Run:

   ```powershell
   node plugins/pictures/generate-pictures.mjs           # Game Boy screen, 160x144 -> 480x432
   node plugins/pictures/generate-pictures.mjs --wide    # 200x120 -> fills the whole 800x480 screen
   node plugins/pictures/generate-pictures.mjs --force   # redo existing ones (e.g. after switching mode)
   ```

3. Each photo becomes `images/<name>.gb.png` (a few KB). Commit and push.

**Drawings** (pen or pencil lines on white paper, like scanned sketches) are
detected automatically and handled differently: the whole drawing is kept
(no cropping, white margins instead), there's no dithering, and every big
pixel a line passes through becomes solid black, so lines stay unbroken.
Force a mode with `--drawing` or `--photo` if the detection guesses wrong.
`DRAWING_LINE_THRESHOLD` at the top of the script controls line boldness.

For photos, the crop is automatic (sharp's "attention" strategy finds the interesting
part), and phone photos are rotated the right way up. Tweaks are constants
at the top of the script: `GAMMA` (lower = brighter) and `PALETTE_GREEN`
(classic pea-green, for viewing on a computer - keep greys for the e-ink
screen). High-contrast photos with a clear subject work best.

## How it works

`fetch.mjs` (runs every 5 minutes via the shared GitHub Actions workflow):

- Lists `images/*.png`.
- Reads the last published `data.json` to see which picture is showing now,
  and picks a random one among the *others* (if there's more than one).
- Writes `public/pictures/data.json` pointing at that image's public URL.

The workflow copies `images/*.png` to GitHub Pages as static files.

## One-time setup

On [usetrmnl.com](https://usetrmnl.com), create another **Private Plugin**:

- Strategy: **Polling**
- Polling URL: `https://hikmek.github.io/trmnl_plugins/pictures/data.json`
- Polling Verb: `GET`
- Refresh rate: **5 minutes** (or slower - each poll gets whatever picture
  was picked most recently)
- Markup (Full tab): paste `template.liquid`
- Markup (Quadrant tab): paste `template.quadrant.liquid`

## Data schema (`data.json`)

```jsonc
{
  "plugin": "pictures",
  "generated_at": "2026-11-24T10:35:00.000Z",
  "image_url": "https://hikmek.github.io/trmnl_plugins/pictures/images/summer-house_2024.png",
  "file": "summer-house_2024.png",
  "title": "summer house 2024",
  "index": 3,          // position in the sorted folder (1-based)
  "gallery_size": 12
}
```

## Local test

```powershell
node plugins/pictures/fetch.mjs
```

## Known limitations

- If `images/` has no PNGs, `fetch.mjs` fails on purpose and the workflow
  falls back to the last published `data.json`.
- Only `.png` is picked up (case-insensitive). Convert JPGs first.
