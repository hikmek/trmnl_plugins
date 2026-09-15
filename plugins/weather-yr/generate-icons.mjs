// One-time / occasional generator for weather-yr's pixel-art weather icons.
//
// These are drawn procedurally (circles/rays/blobs on a boolean grid,
// rendered as pure black/white blocks) - no external image sources, no
// licensing concerns, fully deterministic. Run again after editing the
// shape functions below to regenerate: node plugins/weather-yr/generate-icons.mjs
//
// GRID was bumped from 16 to 32 (all the shape helpers below already work
// in fractions of `size`, so this alone doubles the pixel-art resolution -
// "less coarse" - without needing to rewrite any drawing math). Each
// weather bucket (sun, cloudy, rain, ...) now also has 3 VARIANTS
// (`<bucket>-1.png` / `-2.png` / `-3.png`) instead of a single fixed icon,
// so fetch.mjs's iconUrl() can pick a different-looking icon for the same
// condition on every fetch run ("more icons to randomize from") - see
// fetch.mjs's ICON_VARIANT_COUNT / randomVariant().

import sharp from "sharp";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = path.join(__dirname, "icons");

const GRID = 32; // 32x32 boolean grid per icon (was 16x16)
const OUTPUT_SIZE = 128; // final PNG size (4x upscale of the grid, was 8x)
export const VARIANT_COUNT = 3; // must match fetch.mjs's ICON_VARIANT_COUNT

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

// rayAngles/rayDistances let each sun variant look genuinely different
// (ray count, ray length) rather than just being a copy with noise.
function sunDisk(size, cx, cy, r, rayAngles, rayDistances) {
  const g = create2D(size);
  circle(g, cx, cy, r);
  for (const deg of rayAngles) {
    const rad = (deg * Math.PI) / 180;
    for (const dist of rayDistances) {
      const rr = Math.round(cy + Math.sin(rad) * dist);
      const cc = Math.round(cx + Math.cos(rad) * dist);
      if (rr >= 0 && rr < size && cc >= 0 && cc < size) g[rr][cc] = true;
    }
  }
  return g;
}

// style: "classic" (3 even bumps), "fluffy" (4 bumps, puffier), or "flat"
// (2 big wide bumps + a wider base) - gives cloud-based icons (cloudy,
// fog, rain, snow, thunder) 3 visibly different silhouettes to draw from.
function cloud(size, offsetY, scale, style = "classic") {
  const g = create2D(size);
  let bumps, baseColStart, baseColEnd;
  if (style === "fluffy") {
    bumps = [
      { cx: size * 0.24, cy: size * 0.56 + offsetY, r: size * 0.16 * scale },
      { cx: size * 0.42, cy: size * 0.4 + offsetY, r: size * 0.22 * scale },
      { cx: size * 0.6, cy: size * 0.38 + offsetY, r: size * 0.24 * scale },
      { cx: size * 0.78, cy: size * 0.52 + offsetY, r: size * 0.18 * scale },
    ];
    baseColStart = size * 0.14;
    baseColEnd = size * 0.88;
  } else if (style === "flat") {
    bumps = [
      { cx: size * 0.38, cy: size * 0.46 + offsetY, r: size * 0.26 * scale },
      { cx: size * 0.66, cy: size * 0.46 + offsetY, r: size * 0.26 * scale },
    ];
    baseColStart = size * 0.16;
    baseColEnd = size * 0.88;
  } else {
    bumps = [
      { cx: size * 0.32, cy: size * 0.55 + offsetY, r: size * 0.2 * scale },
      { cx: size * 0.52, cy: size * 0.42 + offsetY, r: size * 0.26 * scale },
      { cx: size * 0.74, cy: size * 0.53 + offsetY, r: size * 0.2 * scale },
    ];
    baseColStart = size * 0.18;
    baseColEnd = size * 0.85;
  }
  for (const b of bumps) circle(g, b.cx, b.cy, b.r);
  const rowStart = Math.round(size * 0.55 + offsetY);
  const rowEnd = Math.round(size * 0.66 + offsetY);
  const colStart = Math.round(baseColStart);
  const colEnd = Math.round(baseColEnd);
  for (let row = rowStart; row <= rowEnd && row < size; row++) {
    for (let col = colStart; col <= colEnd && col < size; col++) {
      if (row >= 0 && col >= 0) g[row][col] = true;
    }
  }
  return g;
}

// style: "drops" (short diagonal streaks, the original look), "heavy"
// (longer, denser streaks), or "dotted" (simple round drops).
function rainDrops(size, rowStart, style = "drops") {
  const g = create2D(size);
  const cols = [size * 0.24, size * 0.42, size * 0.58, size * 0.76];
  if (style === "dotted") {
    for (const c of cols) {
      const rr = rowStart + 1;
      const cc = Math.round(c);
      circle(g, cc, rr, size * 0.02);
    }
    return g;
  }
  const streakLen = style === "heavy" ? 5 : 3;
  for (const c of cols) {
    for (let i = 0; i < streakLen; i++) {
      const rr = rowStart + i;
      const cc = Math.round(c - i * 0.5);
      if (rr < size && cc >= 0) g[rr][cc] = true;
    }
  }
  return g;
}

// style: "plus" (the original plus-shaped flake), "diamond" (rotated
// square), or "cluster" (a small dot cluster) - visibly different flake
// silhouettes at a glance.
function snowFlakes(size, rowStart, style = "plus") {
  const g = create2D(size);
  const positions = [
    [rowStart, size * 0.28],
    [rowStart + 3, size * 0.5],
    [rowStart, size * 0.72],
  ];
  for (const [rf, cf] of positions) {
    const r = Math.round(rf);
    const c = Math.round(cf);
    if (style === "diamond") {
      if (r < size && c < size) g[r][c] = true;
      if (r - 1 >= 0 && c - 1 >= 0) g[r - 1][c - 1] = true;
      if (r - 1 >= 0 && c + 1 < size) g[r - 1][c + 1] = true;
      if (r + 1 < size && c - 1 >= 0) g[r + 1][c - 1] = true;
      if (r + 1 < size && c + 1 < size) g[r + 1][c + 1] = true;
    } else if (style === "cluster") {
      circle(g, c, r, size * 0.05);
    } else {
      if (r < size && c < size) g[r][c] = true;
      if (r - 1 >= 0) g[r - 1][c] = true;
      if (r + 1 < size) g[r + 1][c] = true;
      if (c - 1 >= 0) g[r][c - 1] = true;
      if (c + 1 < size) g[r][c + 1] = true;
    }
  }
  return g;
}

// style: "zigzag" (the original two-stroke bolt), "thick" (wider single
// stroke), or "double" (two parallel bolts, smaller).
//
// IMPORTANT: unlike the other shape helpers, this one's original (16-grid)
// coordinates mix size-relative columns (size * 0.xx) with PLAIN integer
// row steps (rowStart + 1, + 2, ...). Bumping GRID to 32 without also
// scaling those row steps made the bolt collapse to a barely-visible
// sliver (5 rows out of 32 instead of 5 out of 16) - `u` rescales the row
// steps together with GRID, and `blot()` paints each point as a uxu block
// instead of a single pixel so the stroke stays visible at higher
// resolution instead of thinning out.
function lightningBolt(size, rowStart, style = "zigzag") {
  const g = create2D(size);
  const u = size / 16;
  const stroke = Math.max(1, Math.round(u));
  const blot = (rf, cf) => {
    const row = Math.round(rf);
    const col = Math.round(cf);
    for (let dr = 0; dr < stroke; dr++) {
      for (let dc = 0; dc < stroke; dc++) {
        const rr = row + dr;
        const cc = col + dc;
        if (rr >= 0 && rr < size && cc >= 0 && cc < size) g[rr][cc] = true;
      }
    }
  };
  const plot = (points) => points.forEach(([rf, cf]) => blot(rf, cf));
  if (style === "thick") {
    plot([
      [rowStart, size * 0.62],
      [rowStart, size * 0.56],
      [rowStart + 0 * u, size * 0.5],
      [rowStart + 1 * u, size * 0.56],
      [rowStart + 1 * u, size * 0.5],
      [rowStart + 1 * u, size * 0.44],
      [rowStart + 2 * u, size * 0.5],
      [rowStart + 2 * u, size * 0.44],
      [rowStart + 3 * u, size * 0.44],
      [rowStart + 3 * u, size * 0.38],
      [rowStart + 4 * u, size * 0.44],
      [rowStart + 4 * u, size * 0.38],
    ]);
  } else if (style === "double") {
    plot([
      [rowStart, size * 0.4],
      [rowStart + 1 * u, size * 0.37],
      [rowStart + 2 * u, size * 0.34],
      [rowStart + 3 * u, size * 0.31],
      [rowStart, size * 0.66],
      [rowStart + 1 * u, size * 0.63],
      [rowStart + 2 * u, size * 0.6],
      [rowStart + 3 * u, size * 0.57],
    ]);
  } else {
    plot([
      [rowStart, size * 0.62],
      [rowStart, size * 0.56],
      [rowStart + 1 * u, size * 0.56],
      [rowStart + 1 * u, size * 0.5],
      [rowStart + 2 * u, size * 0.5],
      [rowStart + 2 * u, size * 0.44],
      [rowStart + 3 * u, size * 0.44],
      [rowStart + 3 * u, size * 0.5],
      [rowStart + 4 * u, size * 0.5],
      [rowStart + 4 * u, size * 0.56],
      [rowStart + 5 * u, size * 0.56],
    ]);
  }
  return g;
}

// rowCount/stagger let fog variants read as genuinely different densities
// rather than the same 3 lines shifted slightly.
function fogBands(size, rowCount = 3, startFrac = 0.35, endFrac = 0.65) {
  const g = create2D(size);
  const rows = [];
  for (let i = 0; i < rowCount; i++) {
    rows.push(size * (startFrac + ((endFrac - startFrac) * i) / (rowCount - 1)));
  }
  rows.forEach((rf, i) => {
    const r = Math.round(rf);
    const offset = i % 2 === 0 ? 1 : 2;
    for (let col = offset; col < size - 1; col += 2) {
      g[r][col] = true;
    }
  });
  return g;
}

// Each bucket maps to an array of 3 generator functions (variants 1-3).
const ICONS = {
  sun: [
    () => sunDisk(GRID, GRID / 2, GRID / 2, GRID * 0.2, [0, 45, 90, 135, 180, 225, 270, 315], [GRID * 0.235, GRID * 0.28]),
    () => sunDisk(GRID, GRID / 2, GRID / 2, GRID * 0.24, [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330], [GRID * 0.28]),
    () => sunDisk(GRID, GRID / 2, GRID / 2, GRID * 0.17, [0, 90, 180, 270], [GRID * 0.22, GRID * 0.3, GRID * 0.38]),
  ],
  "partly-cloudy": [
    () => {
      const g = create2D(GRID);
      orInto(g, sunDisk(GRID, GRID * 0.38, GRID * 0.38, GRID * 0.16, [0, 45, 90, 135, 180, 225, 270, 315], [GRID * 0.19, GRID * 0.23]));
      orInto(g, cloud(GRID, GRID * 0.12, 0.9, "classic"));
      return g;
    },
    () => {
      const g = create2D(GRID);
      orInto(g, sunDisk(GRID, GRID * 0.34, GRID * 0.32, GRID * 0.19, [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330], [GRID * 0.22]));
      orInto(g, cloud(GRID, GRID * 0.15, 0.85, "fluffy"));
      return g;
    },
    () => {
      const g = create2D(GRID);
      orInto(g, sunDisk(GRID, GRID * 0.4, GRID * 0.4, GRID * 0.14, [0, 90, 180, 270], [GRID * 0.18, GRID * 0.24]));
      orInto(g, cloud(GRID, GRID * 0.1, 0.95, "flat"));
      return g;
    },
  ],
  cloudy: [
    () => cloud(GRID, 0, 1.1, "classic"),
    () => cloud(GRID, 0, 1.1, "fluffy"),
    () => cloud(GRID, 0, 1.15, "flat"),
  ],
  fog: [
    () => {
      const g = create2D(GRID);
      orInto(g, cloud(GRID, -GRID * 0.12, 0.85, "classic"));
      orInto(g, fogBands(GRID, 3));
      return g;
    },
    () => {
      const g = create2D(GRID);
      orInto(g, cloud(GRID, -GRID * 0.15, 0.8, "flat"));
      orInto(g, fogBands(GRID, 4, 0.3, 0.68));
      return g;
    },
    () => fogBands(GRID, 5, 0.2, 0.8),
  ],
  rain: [
    () => {
      const g = create2D(GRID);
      orInto(g, cloud(GRID, -GRID * 0.12, 0.95, "classic"));
      orInto(g, rainDrops(GRID, Math.round(GRID * 0.72), "drops"));
      return g;
    },
    () => {
      const g = create2D(GRID);
      orInto(g, cloud(GRID, -GRID * 0.14, 0.9, "fluffy"));
      orInto(g, rainDrops(GRID, Math.round(GRID * 0.7), "heavy"));
      return g;
    },
    () => {
      const g = create2D(GRID);
      orInto(g, cloud(GRID, -GRID * 0.1, 1, "flat"));
      orInto(g, rainDrops(GRID, Math.round(GRID * 0.72), "dotted"));
      return g;
    },
  ],
  snow: [
    () => {
      const g = create2D(GRID);
      orInto(g, cloud(GRID, -GRID * 0.12, 0.95, "classic"));
      orInto(g, snowFlakes(GRID, Math.round(GRID * 0.72), "plus"));
      return g;
    },
    () => {
      const g = create2D(GRID);
      orInto(g, cloud(GRID, -GRID * 0.14, 0.9, "fluffy"));
      orInto(g, snowFlakes(GRID, Math.round(GRID * 0.7), "diamond"));
      return g;
    },
    () => {
      const g = create2D(GRID);
      orInto(g, cloud(GRID, -GRID * 0.1, 1, "flat"));
      orInto(g, snowFlakes(GRID, Math.round(GRID * 0.72), "cluster"));
      return g;
    },
  ],
  thunder: [
    () => {
      const g = create2D(GRID);
      orInto(g, cloud(GRID, -GRID * 0.15, 0.95, "classic"));
      orInto(g, lightningBolt(GRID, Math.round(GRID * 0.62), "zigzag"));
      return g;
    },
    () => {
      const g = create2D(GRID);
      orInto(g, cloud(GRID, -GRID * 0.16, 0.9, "fluffy"));
      orInto(g, lightningBolt(GRID, Math.round(GRID * 0.6), "thick"));
      return g;
    },
    () => {
      const g = create2D(GRID);
      orInto(g, cloud(GRID, -GRID * 0.12, 1, "flat"));
      orInto(g, lightningBolt(GRID, Math.round(GRID * 0.6), "double"));
      return g;
    },
  ],
};

async function renderIcon(grid) {
  // IMPORTANT: build a 3-channel (RGB) raw buffer and let sharp write a
  // plain 8-bit PNG - do NOT reduce this to a 1-bit/palette PNG. That
  // produced a "1-bit colormap" PNG which TRMNL's rendering pipeline
  // silently fails to display - see this file's history/README for the
  // fuller explanation. 8-bit RGB is the known-good format on this account.
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
  for (const [name, variants] of Object.entries(ICONS)) {
    for (let i = 0; i < variants.length; i++) {
      const grid = variants[i]();
      const png = await renderIcon(grid);
      const outPath = path.join(ICONS_DIR, `${name}-${i + 1}.png`);
      await writeFile(outPath, png);
      console.log(`Wrote icons/${name}-${i + 1}.png (${png.length} bytes)`);
      count++;
    }
  }
  console.log(`\nDone: ${count} icons (${Object.keys(ICONS).length} conditions x ${VARIANT_COUNT} variants) in plugins/weather-yr/icons/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
