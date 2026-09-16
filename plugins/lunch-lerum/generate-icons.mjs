// Generator for lunch-lerum's pixel-art food icons.
//
// Drawn procedurally (bowl shapes + simple geometric toppings) on a boolean
// grid, rendered as pure black/white blocks - no external image sources,
// no licensing concerns, fully deterministic. Run again after editing the
// shape functions below to regenerate:
// node plugins/lunch-lerum/generate-icons.mjs
//
// Icon set covers the most common dish categories on the menu (see
// FOOD_ICON_KEYWORDS in fetch.mjs), plus a "generic" fallback (empty bowl)
// so every dish always gets at least one icon, even if no specific keyword
// matches. A dish can now show SEVERAL icons together (fetch.mjs's
// iconsForDish() returns every matching keyword, not just the first).
//
// GRID was bumped from 16 to 32 ("less coarse", finer pixel-art detail at
// the same final 128px PNG size). Every shape function already draws in
// FRACTIONS of `size` (size * 0.42, etc.), so most of them scale up for
// free - but a few had small PLAIN-NUMBER offsets (e.g. "rowTop + 1.2")
// that were tuned for a 16-grid image. Left alone, those would shrink to a
// barely-visible sliver at 32-grid, the same bug found and fixed in
// weather-yr's lightning-bolt icon (see that file's history) - so every
// such offset below is multiplied by `u = size / 16` to scale together
// with GRID.

import sharp from "sharp";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = path.join(__dirname, "icons");

const GRID = 32; // 32x32 boolean grid per icon (was 16x16)
const OUTPUT_SIZE = 128; // final PNG size (4x upscale of the grid, was 8x)
const RIM_ROW = Math.round(GRID * 0.62 - GRID * 0.28 * 0.55); // top edge of the bowl rim
const TOP_ROW = RIM_ROW - Math.round(5 * (GRID / 16)); // where toppings start (above the rim)

function create2D(size, value = false) {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => value));
}

function orInto(target, source) {
  for (let r = 0; r < target.length; r++) {
    for (let c = 0; c < target.length; c++) {
      if (source[r][c]) target[r][c] = true;
    }
  }
  return target;
}

function fillWhere(g, pred) {
  for (let r = 0; r < g.length; r++) {
    for (let c = 0; c < g.length; c++) {
      if (pred(r, c)) g[r][c] = true;
    }
  }
}

function isInEllipse(r, c, cx, cy, rx, ry) {
  const dx = (c - cx) / rx;
  const dy = (r - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

function circle(g, cx, cy, r) {
  fillWhere(g, (row, col) => isInEllipse(row, col, cx, cy, r, r));
}

function triSign(px, py, ax, ay, bx, by) {
  return (px - bx) * (ay - by) - (ax - bx) * (py - by);
}

function isInTriangle(r, c, ax, ay, bx, by, cx, cy) {
  const d1 = triSign(c, r, ax, ay, bx, by);
  const d2 = triSign(c, r, bx, by, cx, cy);
  const d3 = triSign(c, r, cx, cy, ax, ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function fillRect(g, r0, r1, c0, c1) {
  for (let r = Math.round(r0); r <= Math.round(r1); r++) {
    for (let c = Math.round(c0); c <= Math.round(c1); c++) {
      if (r >= 0 && r < g.length && c >= 0 && c < g.length) g[r][c] = true;
    }
  }
}

function clearRect(g, r0, r1, c0, c1) {
  for (let r = Math.round(r0); r <= Math.round(r1); r++) {
    for (let c = Math.round(c0); c <= Math.round(c1); c++) {
      if (r >= 0 && r < g.length && c >= 0 && c < g.length) g[r][c] = false;
    }
  }
}

// Subtractive circle (a round cutout in an already-solid fill) - the
// existing circle() helper only adds, and the "invisible variant" lesson
// from weather-yr (an additive detail inside solid black renders
// identically to no detail at all) means holes/windows need this instead.
function clearCircle(g, cx, cy, r) {
  const n = g.length;
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (isInEllipse(row, col, cx, cy, r, r)) g[row][col] = false;
    }
  }
}

// A simple bowl/plate: a wide flat-topped arc across the lower third,
// with a thin rim line just above it.
function bowl(size = GRID) {
  const g = create2D(size);
  const cx = (size - 1) / 2;
  const cy = size * 0.62;
  const rx = size * 0.42;
  const ry = size * 0.28;
  fillWhere(g, (row, col) => isInEllipse(row, col, cx, cy, rx, ry) && row >= cy - 1);
  const rimColStart = Math.round(cx - rx * 0.95);
  const rimColEnd = Math.round(cx + rx * 0.95);
  for (let col = rimColStart; col <= rimColEnd; col++) {
    if (col >= 0 && col < size && RIM_ROW >= 0) g[RIM_ROW][col] = true;
  }
  return g;
}

function withBowl(toppingFn) {
  const g = create2D(GRID);
  orInto(g, toppingFn(GRID, TOP_ROW));
  orInto(g, bowl(GRID));
  return g;
}

// --- Topping shapes (each spans roughly rows [rowTop, rowTop+4] at the
// ORIGINAL 16-grid scale - every plain-number offset below is scaled by
// `u` so that span stays proportionally the same at GRID=32) ---

function noodles(size, rowTop) {
  const g = create2D(size);
  const u = size / 16;
  const strands = [
    { phase: 0, amp: 1.3 * u, freq: 0.55, rowOffset: 0 },
    { phase: 2.1, amp: 1.1 * u, freq: 0.5, rowOffset: 2 * u },
    { phase: 4.2, amp: 1.2 * u, freq: 0.6, rowOffset: 4 * u },
  ];
  const colStart = Math.round(size * 0.18);
  const colEnd = Math.round(size * 0.82);
  for (const s of strands) {
    const baseRow = rowTop + s.rowOffset;
    for (let col = colStart; col <= colEnd; col++) {
      const y = baseRow + Math.sin(col * s.freq + s.phase) * s.amp;
      const row = Math.round(y);
      if (row >= 0 && row < size) g[row][col] = true;
    }
  }
  return g;
}

function meatballCluster(size, rowTop) {
  const g = create2D(size);
  const u = size / 16;
  const r = size * 0.12;
  const positions = [
    [rowTop + 1.2 * u, size * 0.32],
    [rowTop + 0.8 * u, size * 0.54],
    [rowTop + 1.6 * u, size * 0.72],
    [rowTop + 2.6 * u, size * 0.5],
  ];
  for (const [row, col] of positions) circle(g, col, row, r);
  return g;
}

function fishShape(size, rowTop) {
  const g = create2D(size);
  const u = size / 16;
  const cy = rowTop + 2.2 * u;
  const bodyCx = size * 0.4;
  const bodyRx = size * 0.2;
  const bodyRy = size * 0.13;
  fillWhere(g, (r, c) => isInEllipse(r, c, bodyCx, cy, bodyRx, bodyRy));
  const tailX0 = bodyCx + bodyRx * 0.6;
  const tailX1 = size * 0.8;
  fillWhere(
    g,
    (r, c) =>
      isInTriangle(r, c, tailX0, cy - bodyRy * 1.1, tailX0, cy + bodyRy * 1.1, tailX1, cy)
  );
  return g;
}

// Salmon: the same fish silhouette as fishShape(), but with 3 short
// diagonal notches CUT OUT of the body (fillet/grain lines) so it reads
// as visually distinct from the plain "fish" icon in pure black/white -
// these are subtracted (false), not added, because a same-color addition
// drawn inside an already-solid silhouette is invisible (the exact bug
// found and fixed in weather-yr's clothing-icon variants - see that
// plugin's README for the full story). Confirmed visible via pixel-diff
// against fish.png, same verification method used there.
function salmonShape(size, rowTop) {
  const g = create2D(size);
  const u = size / 16;
  orInto(g, fishShape(size, rowTop));
  const cy = rowTop + 2.2 * u;
  const bodyCx = size * 0.4;
  const stripeLen = Math.max(2, Math.round(size * 0.09));
  for (const dx of [-0.55, -0.05, 0.45]) {
    const startCol = bodyCx + dx * size * 0.2;
    const startRow = cy - size * 0.09;
    for (let i = 0; i < stripeLen; i++) {
      const row = Math.round(startRow + i);
      const col = Math.round(startCol + i * 0.5);
      if (row >= 0 && row < size && col >= 0 && col < size) g[row][col] = false;
    }
  }
  return g;
}

function drumstick(size, rowTop) {
  const g = create2D(size);
  const u = size / 16;
  const cy = rowTop + 2.2 * u;
  const cx = size * 0.42;
  fillWhere(g, (r, c) => isInEllipse(r, c, cx, cy, size * 0.17, size * 0.15));
  fillRect(g, cy - 0.5 * u, cy + 0.5 * u, cx + size * 0.14, cx + size * 0.32);
  return g;
}

function sausageShape(size, rowTop) {
  const g = create2D(size);
  const u = size / 16;
  const cy = rowTop + 2.2 * u;
  fillWhere(g, (r, c) => isInEllipse(r, c, size * 0.32, cy, size * 0.17, size * 0.1));
  fillWhere(g, (r, c) => isInEllipse(r, c, size * 0.62, cy, size * 0.17, size * 0.1));
  return g;
}

function riceGrains(size, rowTop) {
  const g = create2D(size);
  const u = size / 16;
  const positions = [
    [rowTop + 0.5 * u, size * 0.3],
    [rowTop + 1 * u, size * 0.45],
    [rowTop + 0.7 * u, size * 0.62],
    [rowTop + 1.8 * u, size * 0.35],
    [rowTop + 2 * u, size * 0.55],
    [rowTop + 1.5 * u, size * 0.7],
    [rowTop + 2.8 * u, size * 0.42],
    [rowTop + 3 * u, size * 0.6],
  ];
  for (const [r, c] of positions) {
    const rr = Math.round(r);
    const cc = Math.round(c);
    if (rr >= 0 && rr < size && cc >= 0 && cc < size) g[rr][cc] = true;
  }
  return g;
}

function steamLines(size, rowTop) {
  const g = create2D(size);
  const u = size / 16;
  const cols = [size * 0.35, size * 0.5, size * 0.65];
  for (const c of cols) {
    for (let i = 0; i < 4; i++) {
      const row = Math.round(rowTop + i * 0.9 * u);
      const col = Math.round(c + Math.sin(i * 1.4) * 1.2 * u);
      if (row >= 0 && row < size && col >= 0 && col < size) g[row][col] = true;
    }
  }
  return g;
}

function tacoWedge(size, rowTop) {
  const g = create2D(size);
  const u = size / 16;
  const topY = rowTop;
  const botY = rowTop + 4 * u;
  fillWhere(g, (r, c) => isInTriangle(r, c, size * 0.24, topY, size * 0.76, topY, size * 0.5, botY));
  return g;
}

function pieWedge(size, rowTop) {
  const g = create2D(size);
  const u = size / 16;
  const topY = rowTop;
  const botY = rowTop + 4 * u;
  fillWhere(g, (r, c) => isInTriangle(r, c, size * 0.5, topY, size * 0.26, botY, size * 0.74, botY));
  return g;
}

function pancakeStack(size, rowTop) {
  const g = create2D(size);
  const u = size / 16;
  const cx = size * 0.5;
  fillWhere(g, (r, c) => isInEllipse(r, c, cx, rowTop + 0.8 * u, size * 0.24, size * 0.06));
  fillWhere(g, (r, c) => isInEllipse(r, c, cx, rowTop + 2.4 * u, size * 0.24, size * 0.06));
  return g;
}

function loafRect(size, rowTop) {
  const g = create2D(size);
  const u = size / 16;
  fillRect(g, rowTop, rowTop + 3 * u, size * 0.3, size * 0.7);
  return g;
}

function gratinGrid(size, rowTop) {
  const g = create2D(size);
  const u = size / 16;
  const c0 = Math.round(size * 0.28);
  const c1 = Math.round(size * 0.72);
  const rEnd = Math.round(rowTop + 3 * u);
  for (let r = Math.round(rowTop); r <= rEnd; r++) {
    for (let c = c0; c <= c1; c++) {
      if ((r + c) % 2 === 0) g[r][c] = true;
    }
  }
  return g;
}

// --- Standalone icons (not food-in-a-bowl - represent "who chose", not
// "what food") ---

// Chef's toque: a puffy round top (three overlapping circles, like the
// cloud shape in the weather-yr icons) sitting on a narrower headband.
function chefHat(size = GRID) {
  const g = create2D(size);
  const bumps = [
    { cx: size * 0.34, cy: size * 0.36, r: size * 0.16 },
    { cx: size * 0.5, cy: size * 0.24, r: size * 0.19 },
    { cx: size * 0.66, cy: size * 0.36, r: size * 0.16 },
  ];
  for (const b of bumps) circle(g, b.cx, b.cy, b.r);
  fillRect(g, size * 0.32, size * 0.5, size * 0.26, size * 0.74); // fills gaps between bumps
  fillRect(g, size * 0.62, size * 0.8, size * 0.24, size * 0.76); // headband
  return g;
}

// Two simple people silhouettes (round head + widening body, built from
// stacked rects for a reliably solid silhouette at this resolution) side
// by side, representing "guests" / common people.
function peopleIcon(size = GRID) {
  const g = create2D(size);
  const people = [size * 0.3, size * 0.7];
  for (const cx of people) {
    fillWhere(g, (r, c) => isInEllipse(r, c, cx, size * 0.28, size * 0.13, size * 0.13));
    fillRect(g, size * 0.44, size * 0.6, cx - size * 0.11, cx + size * 0.11); // shoulders
    fillRect(g, size * 0.6, size * 0.84, cx - size * 0.19, cx + size * 0.19); // body
  }
  return g;
}

// A standalone cooking pot ("gryta") - body + two side handles + a lid
// with a knob, and a few steam lines rising above it. This replaces the
// old "stew" icon (a bowl with a swirl topping) per explicit request for
// a literal pot icon rather than a food-in-a-bowl composite.
function potIcon(size = GRID) {
  const g = create2D(size);
  fillRect(g, size * 0.52, size * 0.82, size * 0.26, size * 0.74); // body
  fillRect(g, size * 0.58, size * 0.66, size * 0.12, size * 0.25); // left handle
  fillRect(g, size * 0.58, size * 0.66, size * 0.75, size * 0.88); // right handle
  fillWhere(g, (r, c) => isInEllipse(r, c, size * 0.5, size * 0.49, size * 0.28, size * 0.06)); // lid
  circle(g, size * 0.5, size * 0.41, size * 0.05); // lid knob
  const steamCols = [size * 0.38, size * 0.5, size * 0.62];
  for (const c of steamCols) {
    for (let i = 0; i < 3; i++) {
      const row = Math.round(size * 0.34 - i * size * 0.07);
      const col = Math.round(c + Math.sin(i * 1.4) * size * 0.025);
      if (row >= 0 && row < size && col >= 0 && col < size) g[row][col] = true;
    }
  }
  return g;
}

// A wordplay pair for "Mac n cheese": a generic old boxy computer/monitor
// silhouette (the "Mac" pun) and a wedge of cheese with a few holes, shown
// together (see FOOD_ICON_KEYWORDS in fetch.mjs, which maps the same "mac
// n cheese" match to both icons). Deliberately a generic retro-computer
// shape - no logo, no specific product design - just a box with a screen
// cutout, a floppy-slot cutout, and two feet.
function macintoshIcon(size = GRID) {
  const g = create2D(size);
  fillRect(g, size * 0.12, size * 0.86, size * 0.24, size * 0.76); // case
  // soften the four corners
  clearRect(g, size * 0.12, size * 0.155, size * 0.24, size * 0.285);
  clearRect(g, size * 0.12, size * 0.155, size * 0.695, size * 0.76);
  clearRect(g, size * 0.82, size * 0.86, size * 0.24, size * 0.285);
  clearRect(g, size * 0.82, size * 0.86, size * 0.695, size * 0.76);
  clearRect(g, size * 0.22, size * 0.52, size * 0.32, size * 0.68); // screen cutout
  clearRect(g, size * 0.63, size * 0.655, size * 0.4, size * 0.6); // floppy-slot cutout
  fillRect(g, size * 0.86, size * 0.9, size * 0.28, size * 0.34); // left foot
  fillRect(g, size * 0.86, size * 0.9, size * 0.66, size * 0.72); // right foot
  return g;
}

function cheeseIcon(size = GRID) {
  const g = create2D(size);
  // wedge: pointed tip on the left, flat rind on the right; two holes
  // placed well clear of the tip (a hole too close to the point gets lost
  // in the tip's own natural taper and doesn't read as a hole at all)
  fillWhere(g, (r, c) =>
    isInTriangle(r, c, size * 0.14, size * 0.52, size * 0.86, size * 0.18, size * 0.86, size * 0.86)
  );
  clearCircle(g, size * 0.62, size * 0.4, size * 0.075);
  clearCircle(g, size * 0.68, size * 0.65, size * 0.065);
  return g;
}

const ICONS = {
  pasta: () => withBowl(noodles),
  meatballs: () => withBowl(meatballCluster),
  fish: () => withBowl(fishShape),
  salmon: () => withBowl(salmonShape),
  chicken: () => withBowl(drumstick),
  sausage: () => withBowl(sausageShape),
  rice: () => withBowl(riceGrains),
  soup: () => withBowl(steamLines),
  taco: () => withBowl(tacoWedge),
  pie: () => withBowl(pieWedge),
  pancake: () => withBowl(pancakeStack),
  meatloaf: () => withBowl(loafRect),
  casserole: () => withBowl(gratinGrid),
  pot: () => potIcon(GRID), // "gryta" - standalone pot, not food-in-a-bowl
  macintosh: () => macintoshIcon(GRID), // "Mac n cheese" wordplay - the "Mac"
  cheese: () => cheeseIcon(GRID), // "Mac n cheese" wordplay - the "cheese"
  chef: () => chefHat(GRID), // "Kockens val" - chef's choice
  people: () => peopleIcon(GRID), // "Gästens val" - guest's choice
  generic: () => bowl(GRID), // empty bowl - guaranteed fallback icon
};

async function renderIcon(grid) {
  // Plain 8-bit RGB, not a 1-bit/palette PNG - matches the known-good
  // format documented in weather-yr's/bus-grabo's generators (a palette
  // PNG risks silently failing to render on some TRMNL devices, even
  // though this plugin's own previous palette-PNG icons happened to
  // display correctly - not worth the risk now that everything is being
  // regenerated anyway).
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
  for (const [name, gen] of Object.entries(ICONS)) {
    const grid = gen();
    const png = await renderIcon(grid);
    await writeFile(path.join(ICONS_DIR, `${name}.png`), png);
    console.log(`Wrote icons/${name}.png (${png.length} bytes)`);
  }
  console.log(`\nDone: ${Object.keys(ICONS).length} icons in plugins/lunch-lerum/icons/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
