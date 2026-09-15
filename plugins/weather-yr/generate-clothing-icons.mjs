// One-time / occasional generator for weather-yr's pixel-art clothing
// proposal icons (see fetch.mjs's clothingForTemperature() / expectsRain()
// / needsWindGear()).
//
// Same convention as generate-icons.mjs: a boolean grid, rendered as pure
// black/white blocks (no external image sources), nearest-neighbor
// upscaled to a 128x128 PNG. Run again after editing the shapes below to
// regenerate: node plugins/weather-yr/generate-clothing-icons.mjs
//
// GRID was bumped from 16 to 32 ("less coarse" - all the shape helpers
// below work in fractions of `size`, so this alone doubles the pixel-art
// resolution without needing to rewrite the drawing math). Each clothing
// bucket now also has 3 VARIANTS (`clothing-<slug>-1.png` / `-2.png` /
// `-3.png`) so fetch.mjs's clothingIconUrl() can pick a different-looking
// icon for the same outfit band on every fetch run ("more icons to
// randomize from") - see fetch.mjs's ICON_VARIANT_COUNT / randomVariant().
//
// IMPORTANT LESSON (found via a pixel-diff check after the first version
// of this file): a variant that only ADDS a small accent rect *inside* an
// already-solid silhouette (e.g. a "stripe" or "pocket" drawn on top of a
// torso that's already filled black) renders IDENTICALLY to the base
// variant - there's nothing to see, since the pixels were already black.
// A few of this file's first-draft variants made exactly that mistake
// (confirmed via ImageChops.difference - several variant pairs had zero
// pixel difference). Every variant below instead changes the SILHOUETTE
// itself - a longer/shorter torso or sleeve, a wider collar cutout, a
// bigger accessory that extends past the base shape's edge - so the
// difference is guaranteed visible rather than hidden inside solid fill.

import sharp from "sharp";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = path.join(__dirname, "icons");

const GRID = 32;
const OUTPUT_SIZE = 128;
export const VARIANT_COUNT = 3; // must match fetch.mjs's ICON_VARIANT_COUNT

function create2D(size, value = false) {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => value));
}

function rect(g, r0, r1, c0, c1, val = true) {
  for (let r = Math.round(r0); r <= Math.round(r1); r++) {
    for (let c = Math.round(c0); c <= Math.round(c1); c++) {
      if (r >= 0 && r < g.length && c >= 0 && c < g.length) g[r][c] = val;
    }
  }
  return g;
}

function circle(g, cx, cy, r, val = true) {
  for (let row = 0; row < g.length; row++) {
    for (let col = 0; col < g.length; col++) {
      const dx = col - cx;
      const dy = row - cy;
      if (Math.sqrt(dx * dx + dy * dy) <= r) g[row][col] = val;
    }
  }
  return g;
}

function halfCircleTop(g, cx, cy, r, val = true) {
  for (let row = 0; row < g.length; row++) {
    for (let col = 0; col < g.length; col++) {
      const dx = col - cx;
      const dy = row - cy;
      if (row <= cy && Math.sqrt(dx * dx + dy * dy) <= r) g[row][col] = val;
    }
  }
  return g;
}

function diagLine(g, r0, c0, r1, c1, val = true) {
  const steps = Math.max(Math.abs(r1 - r0), Math.abs(c1 - c0), 1);
  for (let i = 0; i <= steps; i++) {
    const r = Math.round(r0 + ((r1 - r0) * i) / steps);
    const c = Math.round(c0 + ((c1 - c0) * i) / steps);
    if (r >= 0 && r < g.length && c >= 0 && c < g.length) g[r][c] = val;
  }
  return g;
}

// s() scales a 16-grid fraction-based coordinate up to the current 32
// GRID (all the numbers below were originally written for a 16 grid).
const s = (v) => v * (GRID / 16);

// --- Tops -------------------------------------------------------------

// v1: standard tank. v2: wider scoop neckline (cuts into the straps,
// visibly shortening/widening them). v3: cropped hem - shorter torso,
// leaving a visible gap above the shorts.
function tankTop(g, variant) {
  const torsoEnd = variant === 3 ? 6 : 8;
  rect(g, s(3), s(torsoEnd), s(5), s(10));
  rect(g, s(2), s(3), s(6), s(6));
  rect(g, s(2), s(3), s(9), s(9));
  rect(g, s(2), s(2), s(7), s(8), false);
  if (variant === 2) rect(g, s(2), s(2), s(6), s(9), false);
  rect(g, s(9), s(13), s(5), s(10));
  rect(g, s(12), s(13), s(7), s(8), false);
  return g;
}

// v1: standard short sleeves. v2: v-neck collar (taller notch). v3: long
// sleeves reaching down to elbow-length, clearly longer than the base.
function shortsTshirt(g, variant) {
  const sleeveEnd = variant === 3 ? 7 : 4;
  rect(g, s(2), s(7), s(5), s(10));
  rect(g, s(2), s(sleeveEnd), s(3), s(4));
  rect(g, s(2), s(sleeveEnd), s(11), s(12));
  rect(g, s(2), s(2), s(7), s(8), false);
  if (variant === 2) rect(g, s(2), s(3), s(7), s(8), false);
  rect(g, s(9), s(13), s(5), s(10));
  rect(g, s(12), s(13), s(7), s(8), false);
  return g;
}

// v1: standard open-hem light jacket. v2: longer sleeves. v3: closed hem
// (no gap cut at the bottom) - reads as a fuller, zipped-up jacket.
function tshirtJacket(g, variant) {
  const sleeveEnd = variant === 2 ? 6 : 4;
  rect(g, s(2), s(9), s(4), s(11));
  rect(g, s(2), s(sleeveEnd), s(2), s(3));
  rect(g, s(2), s(sleeveEnd), s(12), s(13));
  rect(g, s(2), s(2), s(7), s(8), false);
  if (variant !== 3) rect(g, s(8), s(9), s(7), s(8), false);
  return g;
}

// v1: standard. v2: longer sleeves. v3: cropped/shorter torso (bomber-
// jacket length), hem gap moves up with it.
function lightJacket(g, variant) {
  const sleeveEnd = variant === 2 ? 7 : 5;
  const torsoEnd = variant === 3 ? 9 : 11;
  rect(g, s(2), s(torsoEnd), s(4), s(11));
  rect(g, s(2), s(sleeveEnd), s(2), s(3));
  rect(g, s(2), s(sleeveEnd), s(12), s(13));
  rect(g, s(2), s(2), s(7), s(8), false);
  rect(g, s(torsoEnd - 1), s(torsoEnd), s(7), s(8), false);
  return g;
}

// v1: standard tall closed jacket. v2: wider standing collar (taller
// notch removed at the neckline). v3: cropped/shorter torso.
function jacket(g, variant) {
  const torsoEnd = variant === 3 ? 10 : 13;
  rect(g, s(2), s(torsoEnd), s(4), s(11));
  rect(g, s(2), s(7), s(2), s(3));
  rect(g, s(2), s(7), s(12), s(13));
  rect(g, s(2), variant === 2 ? s(3) : s(2), s(7), s(8), false);
  return g;
}

// v1: standard beanie. v2: bigger beanie (visibly larger circle). v3: no
// beanie, collar pulled up instead (the neckline notch is filled back in,
// reading as a zipped-to-the-chin collar).
function warmJacket(g, variant) {
  rect(g, s(3), s(14), s(4), s(11));
  rect(g, s(3), s(8), s(2), s(3));
  rect(g, s(3), s(8), s(12), s(13));
  if (variant === 3) {
    // no collar-notch cutout at all - reads as zipped up to the chin
  } else {
    rect(g, s(3), s(3), s(7), s(8), false);
  }
  if (variant === 2) {
    circle(g, s(7.5), s(1), s(3.1));
  } else if (variant !== 3) {
    circle(g, s(7.5), s(1), s(2.3));
  }
  return g;
}

// v1: hooded coat + scarf band. v2: boots poking out below the hem
// (outside the base torso's bottom edge - visible). v3: mittens poking
// out past the sleeve cuffs (outside the sleeves' column range).
function winterCoat(g, variant) {
  rect(g, s(5), s(14), s(3), s(12));
  rect(g, s(5), s(9), s(1), s(2));
  rect(g, s(5), s(9), s(13), s(14));
  halfCircleTop(g, s(7.5), s(3), s(3.6));
  rect(g, s(4), s(5), s(2), s(13));
  if (variant === 2) {
    rect(g, s(14.5), s(15.5), s(4), s(6));
    rect(g, s(14.5), s(15.5), s(9), s(11));
  } else if (variant === 3) {
    rect(g, s(9), s(10), s(0), s(1));
    rect(g, s(9), s(10), s(14), s(15));
  }
  return g;
}

// Always has mittens + boots (that's what distinguishes the bucket from
// winter-coat at a glance). v2: a fur-trim hood ring. v3: ear flaps
// flanking the hood, extending past the hood's own circular outline.
function extremeCold(g, variant) {
  rect(g, s(5), s(14), s(3), s(12));
  rect(g, s(5), s(9), s(1), s(2));
  rect(g, s(5), s(9), s(13), s(14));
  halfCircleTop(g, s(7.5), s(3), s(3.6));
  rect(g, s(4), s(5), s(2), s(13));
  rect(g, s(9), s(10), s(0), s(1));
  rect(g, s(9), s(10), s(14), s(15));
  rect(g, s(14.5), s(15.5), s(4), s(6));
  rect(g, s(14.5), s(15.5), s(9), s(11));
  if (variant === 2) {
    circle(g, s(7.5), s(3), s(4.4), true);
    halfCircleTop(g, s(7.5), s(2.4), s(3.4), false);
  } else if (variant === 3) {
    rect(g, s(2), s(4), s(1), s(2));
    rect(g, s(2), s(4), s(13), s(14));
  }
  return g;
}

// v1: plain dome canopy. v2: scalloped canopy edge (notches cut into the
// bottom rim). v3: bigger canopy with ribs poking above the dome outline.
function umbrella(g, variant) {
  if (variant === 2) {
    halfCircleTop(g, s(7.5), s(6), s(6.6));
    for (let i = 0; i < 6; i++) {
      rect(g, s(11.6), s(12.2), s(2 + i * 2), s(2 + i * 2), false);
    }
  } else if (variant === 3) {
    halfCircleTop(g, s(7.5), s(7), s(7.4));
    for (const c of [s(3), s(6), s(9), s(12)]) {
      diagLine(g, s(0.5), s(7.5), s(6.5), c);
    }
  } else {
    halfCircleTop(g, s(7.5), s(6), s(6.3));
  }
  rect(g, s(7), s(12), s(7), s(7));
  rect(g, s(13), s(13), s(7), s(8));
  rect(g, s(14), s(14), s(8), s(9));
  return g;
}

// v1: short gust streaks on the left. v2: longer, denser gusts on the
// left. v3: gusts on both sides, shorter jacket to make room.
function windbreaker(g, variant) {
  const torsoEnd = variant === 3 ? 10 : 12;
  rect(g, s(3), s(torsoEnd), s(5), s(10));
  rect(g, s(3), s(6), s(3), s(4));
  rect(g, s(3), s(6), s(11), s(12));
  rect(g, s(3), s(3), s(7), s(8), false);
  rect(g, s(torsoEnd - 1), s(torsoEnd), s(7), s(8), false);
  if (variant === 2) {
    rect(g, s(3.5), s(3.5), s(0), s(3));
    rect(g, s(6), s(6), s(0), s(4));
    rect(g, s(8.5), s(8.5), s(0), s(3));
    rect(g, s(11), s(11), s(0), s(2));
  } else if (variant === 3) {
    rect(g, s(4), s(4), s(0), s(2));
    rect(g, s(7), s(7), s(0), s(2));
    rect(g, s(4), s(4), s(13), s(15));
    rect(g, s(7), s(7), s(13), s(15));
  } else {
    rect(g, s(4), s(4), s(0), s(2));
    rect(g, s(7), s(7), s(0), s(3));
    rect(g, s(10), s(10), s(0), s(1));
  }
  return g;
}

const BUILDERS = {
  "tank-top": tankTop,
  "shorts-tshirt": shortsTshirt,
  "tshirt-jacket": tshirtJacket,
  "light-jacket": lightJacket,
  jacket,
  "warm-jacket": warmJacket,
  "winter-coat": winterCoat,
  "extreme-cold": extremeCold,
  umbrella,
  windbreaker,
};

async function renderIcon(grid) {
  // See generate-icons.mjs's renderIcon() - plain 8-bit RGB, never a
  // 1-bit/palette PNG (TRMNL silently fails to render those).
  const raw = Buffer.alloc(GRID * GRID * 3);
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const v = grid[r][c] ? 0 : 255;
      const i = (r * GRID + c) * 3;
      raw[i] = v;
      raw[i + 1] = v;
      raw[i + 2] = v;
    }
  }
  return sharp(raw, { raw: { width: GRID, height: GRID, channels: 3 } })
    .resize({ width: OUTPUT_SIZE, height: OUTPUT_SIZE, kernel: "nearest" })
    .png()
    .toBuffer();
}

async function main() {
  await mkdir(ICONS_DIR, { recursive: true });
  let count = 0;
  for (const [name, build] of Object.entries(BUILDERS)) {
    for (let variant = 1; variant <= VARIANT_COUNT; variant++) {
      const grid = create2D(GRID);
      build(grid, variant);
      const png = await renderIcon(grid);
      const outPath = path.join(ICONS_DIR, `clothing-${name}-${variant}.png`);
      await writeFile(outPath, png);
      console.log(`Wrote icons/clothing-${name}-${variant}.png (${png.length} bytes)`);
      count++;
    }
  }
  console.log(`\nDone: ${count} clothing icons (${Object.keys(BUILDERS).length} items x ${VARIANT_COUNT} variants) in plugins/weather-yr/icons/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
