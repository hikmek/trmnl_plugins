// One-time / occasional generator for lunch-lerum's pixel-art food icons.
//
// Drawn procedurally (bowl shapes, wavy noodle strands, meatball circles)
// on a small boolean grid, rendered as pure black/white blocks - no
// external image sources, no licensing concerns, fully deterministic.
// Run again after editing the shape functions below to regenerate:
// node plugins/lunch-lerum/generate-icons.mjs

import sharp from "sharp";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = path.join(__dirname, "icons");

const GRID = 16; // 16x16 boolean grid per icon
const OUTPUT_SIZE = 128; // final PNG size (8x upscale of the grid)

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

function circle(g, cx, cy, r) {
  for (let row = 0; row < g.length; row++) {
    for (let col = 0; col < g.length; col++) {
      const dx = col - cx;
      const dy = row - cy;
      if (Math.sqrt(dx * dx + dy * dy) <= r) g[row][col] = true;
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
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const dx = (col - cx) / rx;
      const dy = (row - cy) / ry;
      const dist = dx * dx + dy * dy;
      if (dist <= 1 && row >= cy - 1) g[row][col] = true;
    }
  }
  // rim: a thin line across the top of the bowl
  const rimRow = Math.round(cy - ry * 0.55);
  const rimColStart = Math.round(cx - rx * 0.95);
  const rimColEnd = Math.round(cx + rx * 0.95);
  for (let col = rimColStart; col <= rimColEnd; col++) {
    if (col >= 0 && col < size && rimRow >= 0) g[rimRow][col] = true;
  }
  return g;
}

// A few wavy noodle strands sitting above the bowl rim.
function noodles(size = GRID, rowTop, rowBottom) {
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
    if (baseRow > rowBottom) continue;
    for (let col = colStart; col <= colEnd; col++) {
      const y = baseRow + Math.sin(col * s.freq + s.phase) * s.amp;
      const row = Math.round(y);
      if (row >= 0 && row < size && col >= 0 && col < size) g[row][col] = true;
    }
  }
  return g;
}

// A cluster of small filled circles ("meatballs") sitting above the bowl rim.
function meatballCluster(size = GRID, rowTop) {
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

const ICONS = {
  spaghetti: () => {
    const g = create2D(GRID);
    const b = bowl(GRID);
    const rimRow = Math.round(GRID * 0.62 - GRID * 0.28 * 0.55);
    orInto(g, noodles(GRID, rimRow - 5, rimRow - 1));
    orInto(g, b);
    return g;
  },
  meatballs: () => {
    const g = create2D(GRID);
    const b = bowl(GRID);
    const rimRow = Math.round(GRID * 0.62 - GRID * 0.28 * 0.55);
    orInto(g, meatballCluster(GRID, rimRow - 4));
    orInto(g, b);
    return g;
  },
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
