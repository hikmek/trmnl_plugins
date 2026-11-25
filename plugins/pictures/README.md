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

## Walking bird (flipbook)

The plugin shows a flipbook of your bird walking across the screen, one
frame per refresh: legs in a 4-step walk cycle, the arm swinging opposite
to the legs, and an occasional blink. 24 frames x 15 minutes = one walk
across every 6 hours (4 per day).

- `walk/source.png` is your drawing (facing left). `generate-walk.mjs` keeps
  the body as drawn, cuts off the legs and redraws them per frame, swings
  the arm and closes the eye on a few frames, then pixelates each frame
  Game Boy style into `walk/frame-00.png` ... `frame-23.png`:

  ```powershell
  node plugins/pictures/generate-walk.mjs
  ```

  Settings at the top of the script: `FRAMES`, `ARM_SWING`, `BLINK_FRAMES`,
  `LIFT`. The measurements (`HIP_Y`, `HIPS`, `ARM_BOX`, `EYE`, ...) are for this
  particular drawing - a new drawing needs new measurements.
- To go back to random pictures from `images/`, set `MODE = "random"` at the
  top of `fetch.mjs`.

## Clock (your handwritten digits)

Under the bird there's a clock drawn with your own handwritten digits.
"Data uppdaterad kl HH:MM idag" is in the title bar, bottom right.

- `digits/source.png` is the handwritten number sheet. `generate-digits.mjs`
  cuts out 0-9 (positions in `DIGIT_BOXES`), pixelates them like the birds
  (1-pixel strokes, Game Boy blocks) and writes `digits/0.png`-`9.png` and
  `digits/colon.png`. Run it again only if you change the sheet or settings:

  ```powershell
  node plugins/pictures/generate-digits.mjs
  ```

- `fetch.mjs` copies the digits to GitHub Pages on every run and adds
  `digits_url` and `updated_display` to `data.json`.
- The template builds the time from TRMNL's `"now"` plus your TRMNL time
  zone offset. E-ink doesn't tick, so the clock shows the time of the last
  screen refresh (at most one refresh interval behind).
- Sizes: the bird is shown at 2/3 size so every Game Boy pixel is an exact
  2x2 block; the digits at full size (3x3 blocks) so they're easy to read.
  In the quadrant layout both are at 1/3 (1 px blocks).

## Why the polling URL has the time in it

TRMNL only renders a new screen when the polled data has **changed**. The
GitHub workflow is scheduled every 5 minutes, but GitHub delays and drops
scheduled runs (sometimes for hours) - and with no new data, TRMNL keeps
the old screen and the clock freezes.

So `fetch.mjs` publishes one small file per minute of the day,
`slots/0000.json` ... `slots/2359.json`, and the polling URL picks the file
for the current minute. Every poll gets different data -> TRMNL redraws on
every refresh, whether or not GitHub has run lately. The picture rotation is
baked into the files (a random picture per 15-minute block, never the same
twice in a row), and is re-shuffled each time the workflow runs.

"Data uppdaterad kl ..." (bottom right) shows when GitHub last rebuilt the
files - if it's hours old, GitHub's schedule is lagging, but the clock and
pictures keep working.

`data.json` is still published (the older single-file feed), but it only
changes when the workflow runs.

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
- Polling URL (exactly like this, Liquid included):
  `https://hikmek.github.io/trmnl_plugins/pictures/slots/{{ "now" | date: "%H%M" }}.json`
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
  "gallery_size": 12,
  "updated_display": "Data uppdaterad kl 15:55 idag",
  "digits_url": "https://hikmek.github.io/trmnl_plugins/pictures/digits"
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
