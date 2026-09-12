// One-time / occasional generator for weather-yr's pixel-art weather icons.
//
// These are drawn procedurally (circles/rays/blobs on a small boolean
// grid, rendered as pure black/white blocks) - no external image sources,
// no licensing concerns, fully deterministic. Run again after editing the
// shape functions below to regenerate: node plugins/weather-yr/generate-icons.mjs

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

function sunDisk(size = GRID, cx = (size - 1) / 2, cy = (size - 1) / 2, r = size * 0.2, withRays = true) {
  const g = create2D(size);
  circle(g, cx, cy, r);
  if (withRays) {
    const angles = [0, 45, 90, 135, 180, 225, 270, 315];
    for (const deg of angles) {
      const rad = (deg * Math.PI) / 180;
      for (const dist of [r + 1.5, r + 3]) {
        const rr = Math.round(cy + Math.sin(rad) * dist);
        const cc = Math.round(cx + Math.cos(rad) * dist);
        if (rr >= 0 && rr < size && cc >= 0 && cc < size) g[rr][cc] = true;
      }
    }
  }
  return g;
}

function cloud(size = GRID, offsetY = 0, scale = 1) {
  const g = create2D(size);
  const bumps = [
    { cx: size * 0.32, cy: size * 0.55 + offsetY, r: size * 0.2 * scale },
    { cx: size * 0.52, cy: size * 0.42 + offsetY, r: size * 0.26 * scale },
    { cx: size * 0.74, cy: size * 0.53 + offsetY, r: size * 0.2 * scale },
  ];
  for (const b of bumps) circle(g, b.cx, b.cy, b.r);
  // flat base band under the bumps
  const rowStart = Math.round(size * 0.55 + offsetY);
  const rowEnd = Math.round(size * 0.66 + offsetY);
  const colStart = Math.round(size * 0.18);
  const colEnd = Math.round(size * 0.85);
  for (let row = rowStart; row <= rowEnd && row < size; row++) {
    for (let col = colStart; col <= colEnd && col < size; col++) {
      if (row >= 0 && col >= 0) g[row][col] = true;
    }
  }
  return g;
}

function rainDrops(size = GRID, rowStart) {
  const g = create2D(size);
  const cols = [size * 0.28, size * 0.5, size * 0.72];
  for (const c of cols) {
    for (let i = 0; i < 3; i++) {
      const rr = rowStart + i;
      const cc = Math.round(c - i * 0.5);
      if (rr < size && cc >= 0) g[rr][cc] = true;
    }
  }
  return g;
}

function snowFlakes(size = GRID, rowStart) {
  const g = create2D(size);
  const positions = [
    [rowStart, size * 0.3],
    [rowStart + 2, size * 0.5],
    [rowStart, size * 0.7],
  ];
  for (const [r, cf] of positions) {
    const c = Math.round(cf);
    // small plus shape
    if (r < size && c < size) g[r][c] = true;
    if (r - 1 >= 0) g[r - 1][c] = true;
    if (r + 1 < size) g[r + 1][c] = true;
    if (c - 1 >= 0) g[r][c - 1] = true;
    if (c + 1 < size) g[r][c + 1] = true;
  }
  return g;
}

function lightningBolt(size = GRID, rowStart) {
  const g = create2D(size);
  // thicker zigzag bolt: wide top-right stroke down to a point, then a
  // shorter stroke back down-left, each 2 cells wide for visibility.
  const strokeA = [
    [rowStart, size * 0.62],
    [rowStart, size * 0.56],
    [rowStart + 1, size * 0.56],
    [rowStart + 1, size * 0.5],
    [rowStart + 2, size * 0.5],
    [rowStart + 2, size * 0.44],
  ];
  const strokeB = [
    [rowStart + 2, size * 0.44],
    [rowStart + 3, size * 0.44],
    [rowStart + 3, size * 0.5],
    [rowStart + 4, size * 0.5],
    [rowStart + 4, size * 0.56],
    [rowStart + 5, size * 0.56],
  ];
  for (const [r, cf] of [...strokeA, ...strokeB]) {
    const row = Math.round(r);
    const col = Math.round(cf);
    if (row < size && row >= 0 && col < size && col >= 0) g[row][col] = true;
  }
  return g;
}

function fogBands(size = GRID) {
  const g = create2D(size);
  const rows = [size * 0.35, size * 0.5, size * 0.65];
  for (const rf of rows) {
    const r = Math.round(rf);
    for (let col = 1; col < size - 1; col += 2) {
      g[r][col] = true;
    }
  }
  return g;
}

const ICONS = {
  sun: () => sunDisk(),
  "partly-cloudy": () => {
    const g = create2D(GRID);
    orInto(g, sunDisk(GRID, GRID * 0.38, GRID * 0.38, GRID * 0.16, true));
    orInto(g, cloud(GRID, GRID * 0.12, 0.9));
    return g;
  },
  cloudy: () => cloud(GRID, 0, 1.1),
  fog: () => {
    const g = create2D(GRID);
    orInto(g, cloud(GRID, -GRID * 0.12, 0.85));
    orInto(g, fogBands(GRID));
    return g;
  },
  rain: () => {
    const g = create2D(GRID);
    orInto(g, cloud(GRID, -GRID * 0.12, 0.95));
    orInto(g, rainDrops(GRID, Math.round(GRID * 0.72)));
    return g;
  },
  snow: () => {
    const g = create2D(GRID);
    orInto(g, cloud(GRID, -GRID * 0.12, 0.95));
    orInto(g, snowFlakes(GRID, Math.round(GRID * 0.72)));
    return g;
  },
  thunder: () => {
    const g = create2D(GRID);
    orInto(g, cloud(GRID, -GRID * 0.15, 0.95));
    orInto(g, lightningBolt(GRID, Math.round(GRID * 0.62)));
    return g;
  },
};

async function renderIcon(grid) {
  // IMPORTANT: build a 3-channel (RGB) raw buffer and let sharp write a
  // plain 8-bit PNG - do NOT reduce this to a 1-bit/palette PNG (e.g. via
  // `.png({ palette: true, colors: 2 })`, the previous approach). That
  // produced a "1-bit colormap" PNG which TRMNL's rendering pipeline
  // silently fails to display (the icon just doesn't show up at all - not
  // even a broken-image glyph). Comparing against plugins/broforce's
  // portraits, which are plain sharp `.png()` output (8-bit RGB) and DO
  // render correctly on the same TRMNL account, 8-bit RGB is the known-good
  // format, so this matches that exactly rather than just disabling the
  // palette option and hoping for 8-bit grayscale instead.
  const raw = Buffer.alloc(GRID * GRID * 3);
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      // black shape (0) on white background (255)
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
    const outPath = path.join(ICONS_DIR, `${name}.png`);
    await writeFile(outPath, png);
    console.log(`Wrote icons/${name}.png (${png.length} bytes)`);
  }
  console.log(`\nDone: ${Object.keys(ICONS).length} icons in plugins/weather-yr/icons/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
