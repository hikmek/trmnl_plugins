// Generator for lunch-lerum's pixel-art food icons.
//
// Drawn procedurally (bowl shapes + simple geometric toppings) on a small
// boolean grid, rendered as pure black/white blocks - no external image
// sources, no licensing concerns, fully deterministic. Run again after
// editing the shape functions below to regenerate:
// node plugins/lunch-lerum/generate-icons.mjs
//
// Icon set covers the most common dish categories on the menu (see
// FOOD_ICON_KEYWORDS in fetch.mjs), plus a "generic" fallback (empty bowl)
// so every dish always gets an icon, even if no specific keyword matches.

import sharp from "sharp";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = path.join(__dirname, "icons");

const GRID = 16; // 16x16 boolean grid per icon
const OUTPUT_SIZE = 128; // final PNG size (8x upscale of the grid)
const RIM_ROW = Math.round(GRID * 0.62 - GRID * 0.28 * 0.55); // top edge of the bowl rim
const TOP_ROW = RIM_ROW - 5; // where toppings start (above the rim)

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

// --- Topping shapes (each spans roughly rows [rowTop, rowTop+4]) ---

function noodles(size, rowTop) {
  const g = create2D(size);
  const strands = [
    { phase: 0, amp: 1.3, freq: 0.55, rowOffset: 0 },
    { phase: 2.1, amp: 1.1, freq: 0.5, rowOffset: 2 },
    { phase: 4.2, amp: 1.2, freq: 0.6, rowOffset: 4 },
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
  const r = size * 0.12;
  const positions = [
    [rowTop + 1.2, size * 0.32],
    [rowTop + 0.8, size * 0.54],
    [rowTop + 1.6, size * 0.72],
    [rowTop + 2.6, size * 0.5],
  ];
  for (const [row, col] of positions) circle(g, col, row, r);
  return g;
}

function fishShape(size, rowTop) {
  const g = create2D(size);
  const cy = rowTop + 2.2;
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

function drumstick(size, rowTop) {
  const g = create2D(size);
  const cy = rowTop + 2.2;
  const cx = size * 0.42;
  fillWhere(g, (r, c) => isInEllipse(r, c, cx, cy, size * 0.17, size * 0.15));
  fillRect(g, cy - 0.5, cy + 0.5, cx + size * 0.14, cx + size * 0.32);
  return g;
}

function sausageShape(size, rowTop) {
  const g = create2D(size);
  const cy = rowTop + 2.2;
  fillWhere(g, (r, c) => isInEllipse(r, c, size * 0.32, cy, size * 0.17, size * 0.1));
  fillWhere(g, (r, c) => isInEllipse(r, c, size * 0.62, cy, size * 0.17, size * 0.1));
  return g;
}

function riceGrains(size, rowTop) {
  const g = create2D(size);
  const positions = [
    [rowTop + 0.5, size * 0.3],
    [rowTop + 1, size * 0.45],
    [rowTop + 0.7, size * 0.62],
    [rowTop + 1.8, size * 0.35],
    [rowTop + 2, size * 0.55],
    [rowTop + 1.5, size * 0.7],
    [rowTop + 2.8, size * 0.42],
    [rowTop + 3, size * 0.6],
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
  const cols = [size * 0.35, size * 0.5, size * 0.65];
  for (const c of cols) {
    for (let i = 0; i < 4; i++) {
      const row = Math.round(rowTop + i * 0.9);
      const col = Math.round(c + Math.sin(i * 1.4) * 1.2);
      if (row >= 0 && row < size && col >= 0 && col < size) g[row][col] = true;
    }
  }
  return g;
}

function tacoWedge(size, rowTop) {
  const g = create2D(size);
  const topY = rowTop;
  const botY = rowTop + 4;
  fillWhere(g, (r, c) => isInTriangle(r, c, size * 0.24, topY, size * 0.76, topY, size * 0.5, botY));
  return g;
}

function stewSwirl(size, rowTop) {
  const g = create2D(size);
  const cy = rowTop + 2.2;
  const cx = size * 0.5;
  const rOuter = size * 0.19;
  const rInner = size * 0.1;
  fillWhere(
    g,
    (r, c) => isInEllipse(r, c, cx, cy, rOuter, rOuter) && !isInEllipse(r, c, cx, cy, rInner, rInner)
  );
  return g;
}

function pieWedge(size, rowTop) {
  const g = create2D(size);
  const topY = rowTop;
  const botY = rowTop + 4;
  fillWhere(g, (r, c) => isInTriangle(r, c, size * 0.5, topY, size * 0.26, botY, size * 0.74, botY));
  return g;
}

function pancakeStack(size, rowTop) {
  const g = create2D(size);
  const cx = size * 0.5;
  fillWhere(g, (r, c) => isInEllipse(r, c, cx, rowTop + 0.8, size * 0.24, size * 0.06));
  fillWhere(g, (r, c) => isInEllipse(r, c, cx, rowTop + 2.4, size * 0.24, size * 0.06));
  return g;
}

function loafRect(size, rowTop) {
  const g = create2D(size);
  fillRect(g, rowTop, rowTop + 3, size * 0.3, size * 0.7);
  return g;
}

function gratinGrid(size, rowTop) {
  const g = create2D(size);
  const c0 = Math.round(size * 0.28);
  const c1 = Math.round(size * 0.72);
  for (let r = rowTop; r <= rowTop + 3; r++) {
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

const ICONS = {
  pasta: () => withBowl(noodles),
  meatballs: () => withBowl(meatballCluster),
  fish: () => withBowl(fishShape),
  chicken: () => withBowl(drumstick),
  sausage: () => withBowl(sausageShape),
  rice: () => withBowl(riceGrains),
  soup: () => withBowl(steamLines),
  taco: () => withBowl(tacoWedge),
  stew: () => withBowl(stewSwirl),
  pie: () => withBowl(pieWedge),
  pancake: () => withBowl(pancakeStack),
  meatloaf: () => withBowl(loafRect),
  casserole: () => withBowl(gratinGrid),
  chef: () => chefHat(GRID), // "Kockens val" - chef's choice
  people: () => peopleIcon(GRID), // "Gästens val" - guest's choice
  generic: () => bowl(GRID), // empty bowl - guaranteed fallback icon
};

async function renderIcon(grid) {
  const raw = Buffer.alloc(GRID * GRID);
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      raw[r * GRID + c] = grid[r][c] ? 0 : 255;
    }
  }
  return sharp(raw, { raw: { width: GRID, height: GRID, channels: 1 } })
    .resize({ width: OUTPUT_SIZE, height: OUTPUT_SIZE, kernel: "nearest" })
    .png({ palette: true, colors: 2, dither: 0 })
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
