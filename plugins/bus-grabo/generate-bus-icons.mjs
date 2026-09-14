// One-time / occasional generator for bus-grabo's pixel-art bus icons.
//
// Same convention as weather-yr's generate-icons.mjs (see that file's
// comments for the fuller history): drawn procedurally on a small boolean
// grid (here 32 wide x 16 tall - a bus is landscape, unlike the weather
// icons' square grid), nearest-neighbor upscaled, and rendered as a plain
// 8-bit RGB PNG via sharp - NOT a palette/1-bit PNG, which TRMNL's
// rendering pipeline silently fails to display at all. Run again after
// editing the shapes/variant list below to regenerate:
//   node plugins/bus-grabo/generate-bus-icons.mjs
//
// These are stylized silhouettes, not reproductions of specific real
// vehicles - at e-ink pixel-art resolution there's no meaningful
// difference between "a generic 1950s coach" and a specific real model, so
// each variant is a distinct combination of body shape parameters (deck
// count, nose style, roof style, window count, roof vent, side stripe,
// open rear platform) with a world-city + decade flavored name, not a
// factual claim about that city's actual historical fleet. fetch.mjs picks
// two of these at random (guaranteed different from each other) on every
// fetch - see BUS_ICON_NAMES there.

import sharp from "sharp";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = path.join(__dirname, "icons");

const GRID_W = 32;
const GRID_H = 16;
const UPSCALE = 8; // -> 256x128 output PNG

function create2D(rows, cols, value = false) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => value));
}

function rect(g, r0, r1, c0, c1, val = true) {
  for (let r = Math.max(0, r0); r <= Math.min(GRID_H - 1, r1); r++) {
    for (let c = Math.max(0, c0); c <= Math.min(GRID_W - 1, c1); c++) {
      g[r][c] = val;
    }
  }
}

// Spreads `count` windows evenly across [c0, c1] (inclusive), regardless of
// count, rather than clustering them at one end - each window's width and
// position is computed from an even "slot" so the pattern looks balanced
// for any window count (3 through 7 are used across the 30 variants).
function punchWindowsEven(g, r0, r1, c0, c1, count) {
  const width = c1 - c0 + 1;
  if (count <= 0 || width <= 0) return;
  const slot = width / count;
  const winW = Math.max(1, Math.round(slot * 0.55));
  for (let i = 0; i < count; i++) {
    const start = Math.round(c0 + i * slot + (slot - winW) / 2);
    rect(g, r0, r1, start, start + winW - 1, false);
  }
}

// p: { decks: 1|2, nose: "flat"|"hooded"|"snub", roof: "flat"|"curved",
//      windows: number, vent?: bool, stripe?: bool, rearOpen?: bool }
function buildBus(p) {
  const g = create2D(GRID_H, GRID_W, false);
  const bodyBottom = 10;
  const bodyTop = p.decks === 2 ? 1 : 4;
  const noseW = { flat: 0, hooded: 7, snub: 4 }[p.nose];

  // main body
  rect(g, bodyTop, bodyBottom, noseW, GRID_W - 2, true);

  // rounded roof corners (streamlined look)
  if (p.roof === "curved") {
    g[bodyTop][noseW] = false;
    g[bodyTop][GRID_W - 2] = false;
  }

  // front hood/nose block (engine compartment ahead of the cab, vintage
  // look) or a short snub overhang (rounder, van-like front)
  if (noseW > 0) {
    const noseTop = p.nose === "hooded" ? bodyBottom - 3 : bodyTop + 2;
    rect(g, noseTop, bodyBottom, 0, noseW, true);
    rect(g, noseTop, noseTop, noseW - 1, noseW, false); // windshield step notch
  }

  // windows - one row (single deck) or two rows (double deck), spread
  // evenly across the body length starting just past the nose
  const winC0 = noseW + (p.decks === 2 ? 1 : 2);
  const winC1 = GRID_W - 3;
  if (p.decks === 1) {
    punchWindowsEven(g, bodyTop + 1, bodyTop + 3, winC0, winC1, p.windows);
  } else {
    punchWindowsEven(g, bodyTop + 1, bodyTop + 3, winC0, winC1, p.windows);
    punchWindowsEven(g, bodyTop + 6, bodyTop + 8, winC0, winC1, p.windows);
  }

  // decorative side stripe (a thin cleared band low on the body)
  if (p.stripe) {
    rect(g, bodyBottom - 2, bodyBottom - 2, noseW, GRID_W - 2, false);
  }

  // roof vent / luggage rack bump
  if (p.vent) {
    const mid = Math.floor(GRID_W / 2);
    rect(g, bodyTop - 2, bodyTop - 1, mid - 4, mid + 3, true);
  }

  // open rear boarding platform (classic double-decker detail)
  if (p.rearOpen) {
    rect(g, bodyBottom - 3, bodyBottom, GRID_W - 2, GRID_W - 1, false);
  }

  // wheels - solid blocks read more clearly than circles at this
  // resolution (a small-radius circle mostly overlapping the body silhouette
  // rendered as an ambiguous pointed nub in early drafts of this file)
  const wheelW = 3;
  const wheelH = 3;
  const wheelTop = bodyBottom + 1;
  const x1 = noseW + 3;
  const x2 = GRID_W - 6;
  rect(g, wheelTop, wheelTop + wheelH - 1, x1 - 1, x1 + wheelW - 2, true);
  rect(g, wheelTop, wheelTop + wheelH - 1, x2 - 1, x2 + wheelW - 2, true);

  return g;
}

// 30 named variants - world-city + decade flavored names (see file header:
// stylized silhouettes, not historical claims), spanning 1930s (hooded
// nose), 1950s (coach/flat nose) and 1960s (flat/snub, more windows) looks,
// plus a handful of double-deckers.
const BUS_VARIANTS = {
  "brobacka-1930": { decks: 1, nose: "hooded", roof: "curved", windows: 3 },
  "sjovik-1930": { decks: 1, nose: "hooded", roof: "curved", windows: 4 },
  "gothenburg-1930": { decks: 1, nose: "hooded", roof: "flat", windows: 3, stripe: true },
  "chicago-1930": { decks: 1, nose: "hooded", roof: "curved", windows: 4, vent: true },
  "london-1930": { decks: 2, nose: "hooded", roof: "flat", windows: 4, rearOpen: true },
  "paris-1930": { decks: 1, nose: "hooded", roof: "curved", windows: 5 },
  "berlin-1930": { decks: 1, nose: "hooded", roof: "flat", windows: 3, vent: true, stripe: true },

  "lerum-1950": { decks: 1, nose: "flat", roof: "curved", windows: 6, vent: true },
  "grabo-1950": { decks: 1, nose: "flat", roof: "curved", windows: 5, stripe: true },
  "london-1950": { decks: 2, nose: "flat", roof: "flat", windows: 5, rearOpen: true },
  "moscow-1950": { decks: 1, nose: "flat", roof: "flat", windows: 5 },
  "tokyo-1950": { decks: 1, nose: "flat", roof: "curved", windows: 4, vent: true, stripe: true },
  "havana-1950": { decks: 1, nose: "snub", roof: "curved", windows: 4, stripe: true },
  "rio-1950": { decks: 1, nose: "snub", roof: "curved", windows: 3, vent: true },
  "cairo-1950": { decks: 1, nose: "flat", roof: "flat", windows: 7 },
  "mumbai-1950": { decks: 2, nose: "flat", roof: "curved", windows: 4, rearOpen: true },
  "sydney-1950": { decks: 1, nose: "flat", roof: "curved", windows: 5, vent: true, stripe: true },

  "gothenburg-1960": { decks: 1, nose: "flat", roof: "flat", windows: 6 },
  "stockholm-1960": { decks: 1, nose: "flat", roof: "flat", windows: 7, stripe: true },
  "wolfsburg-1960": { decks: 1, nose: "snub", roof: "curved", windows: 3, vent: true, stripe: true },
  "detroit-1960": { decks: 1, nose: "flat", roof: "flat", windows: 5, stripe: true },
  "new-york-1960": { decks: 2, nose: "flat", roof: "flat", windows: 6, rearOpen: true },
  "amsterdam-1960": { decks: 1, nose: "snub", roof: "curved", windows: 4, vent: true },
  "oslo-1960": { decks: 1, nose: "flat", roof: "curved", windows: 6, vent: true },
  "helsinki-1960": { decks: 1, nose: "flat", roof: "flat", windows: 4, stripe: true },
  "seoul-1960": { decks: 1, nose: "snub", roof: "flat", windows: 5 },
  "nairobi-1960": { decks: 1, nose: "flat", roof: "curved", windows: 5, vent: true, stripe: true },
  "lagos-1960": { decks: 1, nose: "flat", roof: "flat", windows: 6, stripe: true },
  "mexico-city-1960": { decks: 1, nose: "snub", roof: "curved", windows: 4, stripe: true },
  "grabo-express-1960": { decks: 2, nose: "flat", roof: "curved", windows: 5, rearOpen: true, vent: true },
};

async function renderIcon(grid) {
  // Plain 8-bit RGB via a raw buffer, same known-good format as
  // weather-yr's icons (see that file's renderIcon() for the fuller
  // explanation of why a palette/1-bit PNG silently fails to render).
  const raw = Buffer.alloc(GRID_W * GRID_H * 3);
  for (let r = 0; r < GRID_H; r++) {
    for (let c = 0; c < GRID_W; c++) {
      const v = grid[r][c] ? 0 : 255; // black shape on white background
      const i = (r * GRID_W + c) * 3;
      raw[i] = v;
      raw[i + 1] = v;
      raw[i + 2] = v;
    }
  }
  return sharp(raw, { raw: { width: GRID_W, height: GRID_H, channels: 3 } })
    .resize({ width: GRID_W * UPSCALE, height: GRID_H * UPSCALE, kernel: "nearest" })
    .png()
    .toBuffer();
}

async function main() {
  await mkdir(ICONS_DIR, { recursive: true });
  for (const [name, params] of Object.entries(BUS_VARIANTS)) {
    const grid = buildBus(params);
    const png = await renderIcon(grid);
    const outPath = path.join(ICONS_DIR, `bus-${name}.png`);
    await writeFile(outPath, png);
    console.log(`Wrote icons/bus-${name}.png (${png.length} bytes)`);
  }
  console.log(`\nDone: ${Object.keys(BUS_VARIANTS).length} bus icons in plugins/bus-grabo/icons/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
