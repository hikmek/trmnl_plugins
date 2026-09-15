// One-time / occasional generator for weather-yr's pixel-art clothing
// proposal icons (see fetch.mjs's clothingForTemperature() / expectsRain()).
//
// Same convention as generate-icons.mjs: a 16x16 boolean grid, rendered as
// pure black/white blocks (no external image sources), nearest-neighbor
// upscaled to a 128x128 PNG. Run again after editing the shapes below to
// regenerate: node plugins/weather-yr/generate-clothing-icons.mjs

import sharp from "sharp";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = path.join(__dirname, "icons");

const GRID = 16;
const OUTPUT_SIZE = 128;

function create2D(size, value = false) {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => value));
}

function rect(g, r0, r1, c0, c1, val = true) {
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
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

const ICONS = {
  // Very hot: sleeveless tank top (thin straps, no sleeve blocks) + shorts.
  "tank-top": () => {
    const g = create2D(GRID);
    rect(g, 3, 8, 5, 10); // torso, sleeveless
    rect(g, 2, 3, 6, 6); // left strap
    rect(g, 2, 3, 9, 9); // right strap
    rect(g, 2, 2, 7, 8, false); // collar notch
    rect(g, 9, 13, 5, 10); // shorts block
    rect(g, 12, 13, 7, 8, false); // leg split
    return g;
  },
  // Hot weather: t-shirt + shorts, with a small leg-split gap at the hem.
  "shorts-tshirt": () => {
    const g = create2D(GRID);
    rect(g, 2, 7, 5, 10); // torso
    rect(g, 2, 4, 3, 4); // left sleeve
    rect(g, 2, 4, 11, 12); // right sleeve
    rect(g, 2, 2, 7, 8, false); // collar notch
    rect(g, 9, 13, 5, 10); // shorts block
    rect(g, 12, 13, 7, 8, false); // leg split
    return g;
  },
  // Mild weather: shorter, open-hem light jacket over a t-shirt.
  "tshirt-jacket": () => {
    const g = create2D(GRID);
    rect(g, 2, 9, 4, 11);
    rect(g, 2, 4, 2, 3);
    rect(g, 2, 4, 12, 13);
    rect(g, 2, 2, 7, 8, false); // collar notch
    rect(g, 8, 9, 7, 8, false); // open hem
    return g;
  },
  // Cool-mild gap between tshirt-jacket and a full closed jacket: taller
  // and longer-sleeved than tshirt-jacket, but still open at the hem.
  "light-jacket": () => {
    const g = create2D(GRID);
    rect(g, 2, 11, 4, 11);
    rect(g, 2, 5, 2, 3);
    rect(g, 2, 5, 12, 13);
    rect(g, 2, 2, 7, 8, false); // collar notch
    rect(g, 10, 11, 7, 8, false); // open hem
    return g;
  },
  // Cool weather: closed, taller jacket.
  jacket: () => {
    const g = create2D(GRID);
    rect(g, 2, 13, 4, 11);
    rect(g, 2, 7, 2, 3);
    rect(g, 2, 7, 12, 13);
    rect(g, 2, 2, 7, 8, false);
    return g;
  },
  // Cold weather: jacket + a beanie above the collar.
  "warm-jacket": () => {
    const g = create2D(GRID);
    rect(g, 3, 14, 4, 11);
    rect(g, 3, 8, 2, 3);
    rect(g, 3, 8, 12, 13);
    rect(g, 3, 3, 7, 8, false);
    circle(g, 7.5, 1, 2.3);
    return g;
  },
  // Very cold: bulky coat, hood, and a scarf band wider than the torso.
  "winter-coat": () => {
    const g = create2D(GRID);
    rect(g, 5, 14, 3, 12);
    rect(g, 5, 9, 1, 2);
    rect(g, 5, 9, 13, 14);
    halfCircleTop(g, 7.5, 3, 3.6);
    rect(g, 4, 5, 2, 13);
    return g;
  },
  // Extreme cold: winter-coat plus mittens poking past the cuffs and a
  // pair of boots at the hem - visually distinct at a glance from
  // winter-coat, not just a relabeling of the same silhouette.
  "extreme-cold": () => {
    const g = create2D(GRID);
    rect(g, 5, 14, 3, 12);
    rect(g, 5, 9, 1, 2);
    rect(g, 5, 9, 13, 14);
    halfCircleTop(g, 7.5, 3, 3.6);
    rect(g, 4, 5, 2, 13); // scarf band
    rect(g, 9, 10, 0, 1); // left mitten past the cuff
    rect(g, 9, 10, 14, 15); // right mitten past the cuff
    rect(g, 14, 15, 4, 6); // left boot
    rect(g, 14, 15, 9, 11); // right boot
    return g;
  },
  // Rain gear proposal (shown alongside the temperature-based outfit icon
  // whenever fetch.mjs's expectsRain() is true): a simple umbrella.
  umbrella: () => {
    const g = create2D(GRID);
    halfCircleTop(g, 7.5, 6, 6.3);
    rect(g, 7, 12, 7, 7);
    rect(g, 13, 13, 7, 8);
    rect(g, 14, 14, 8, 9);
    return g;
  },
  // Wind gear proposal (shown alongside the outfit icon whenever
  // fetch.mjs's needsWindGear() is true): a light jacket silhouette with a
  // few short streaks beside it suggesting gusts - visually distinct from
  // the plain jacket/light-jacket icons so it reads as "windy", not just
  // "another jacket band".
  windbreaker: () => {
    const g = create2D(GRID);
    rect(g, 3, 12, 5, 10); // jacket body
    rect(g, 3, 6, 3, 4); // left sleeve
    rect(g, 3, 6, 11, 12); // right sleeve
    rect(g, 3, 3, 7, 8, false); // collar notch
    rect(g, 11, 12, 7, 8, false); // open hem
    // wind streaks (gusts blowing past, to the left of the jacket)
    rect(g, 4, 4, 0, 2);
    rect(g, 7, 7, 0, 3);
    rect(g, 10, 10, 0, 1);
    return g;
  },
};

async function renderIcon(grid) {
  // IMPORTANT: build a 3-channel (RGB) raw buffer and let sharp write a
  // plain 8-bit PNG - do NOT reduce this to a 1-bit/palette PNG (e.g. via
  // `.png({ palette: true, colors: 2 })`, the previous approach here). That
  // produced a "1-bit colormap" PNG which TRMNL's rendering pipeline
  // silently fails to display (the icon just doesn't show up at all - not
  // even a broken-image glyph). Comparing against plugins/broforce's
  // portraits, which are plain sharp `.png()` output (8-bit RGB) and DO
  // render correctly on the same TRMNL account, 8-bit RGB is the known-good
  // format - see generate-icons.mjs's renderIcon() for the same fix and
  // fuller explanation.
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
    const outPath = path.join(ICONS_DIR, `clothing-${name}.png`);
    await writeFile(outPath, png);
    console.log(`Wrote icons/clothing-${name}.png (${png.length} bytes)`);
  }
  console.log(`\nDone: ${Object.keys(ICONS).length} clothing icons in plugins/weather-yr/icons/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
