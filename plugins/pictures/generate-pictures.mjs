// Turns your own photos into Game Boy style pixel art for the pictures plugin.
//
// Run manually (NOT part of the recurring workflow) whenever you add photos:
//
//   node plugins/pictures/generate-pictures.mjs            # new photos only
//   node plugins/pictures/generate-pictures.mjs --force    # redo everything
//   node plugins/pictures/generate-pictures.mjs --wide     # full-screen 5:3
//
// Drawings (black lines on white paper) are detected automatically and get
// a different treatment - see "Drawings" below. Override the detection with
// --drawing or --photo.
//
// Reads every photo in plugins/pictures/originals/ (jpg, png, webp, tif) and
// writes plugins/pictures/images/<name>.gb.png. The originals/ folder is in
// .gitignore - your full-size photos stay on your PC; only the small
// pixel-art PNGs are committed and published.
//
// The Game Boy look, step by step:
//   1. Crop to the Game Boy's real screen size, 160x144 "big pixels"
//      (or 200x120 with --wide, which fills the whole TRMNL screen).
//   2. Greyscale + auto-contrast, with a slight brightening curve - photos
//      come out too dark otherwise.
//   3. Reduce to exactly 4 shades with a 4x4 Bayer ordered dither: the
//      regular checkerboard/crosshatch patterns Game Boy artists used to
//      fake in-between shades (instead of the random-looking noise of
//      error-diffusion dithering).
//   4. Upscale with nearest-neighbour (x3, or x4 for --wide) so every
//      Game Boy pixel becomes a crisp square block on the e-ink screen.
//
// Drawings: cropping and dithering would cut off parts of the drawing and
// break thin pen lines into speckles, so instead the whole drawing is fitted
// inside the grid (white margins), and every Game Boy pixel that any pen
// line passes through becomes solid black - lines stay continuous, 1 big
// pixel wide, like hand-placed Game Boy sprite art.
//
// The 4 shades are greys, not the original pea-green - the TRMNL screen is
// greyscale, and greys map 1:1 onto its 4 grey levels. (Set PALETTE_GREEN =
// true to get the classic green for viewing on a computer.)

import sharp from "sharp";
import { readdir, mkdir, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ORIGINALS_DIR = path.join(__dirname, "originals");
const IMAGES_DIR = path.join(__dirname, "images");

const args = new Set(process.argv.slice(2));
const FORCE = args.has("--force");
const WIDE = args.has("--wide");
const FORCE_MODE = args.has("--drawing") ? "drawing" : args.has("--photo") ? "photo" : null;

// Game Boy screen: 160x144 (10:9). Wide mode: 200x120 (5:3 = TRMNL 800x480).
const GRID_W = WIDE ? 200 : 160;
const GRID_H = WIDE ? 120 : 144;
const SCALE = WIDE ? 4 : 3; // 480x432 or 800x480 output

// Brightening curve applied before dithering (1 = none, <1 = brighter).
const GAMMA = 0.85;

// Drawings: a big pixel darker than this (0-255) becomes a black line pixel.
// Higher = thicker/bolder lines; lower = only the strongest strokes survive.
const DRAWING_LINE_THRESHOLD = 235;

// Darkest -> lightest. Greys for e-ink; the green set is the original DMG.
const PALETTE_GREEN = false;
const PALETTE = PALETTE_GREEN
  ? [[15, 56, 15], [48, 98, 48], [139, 172, 15], [155, 188, 15]]
  : [[0, 0, 0], [85, 85, 85], [170, 170, 170], [255, 255, 255]];

// 4x4 Bayer matrix, values 0..15.
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

const PHOTO_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"]);

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// "Sommar i Lerum.jpg" -> "Sommar-i-Lerum" (file-system and URL friendly;
// fetch.mjs turns the dashes back into spaces for the caption).
function slug(file) {
  return path
    .parse(file)
    .name.normalize("NFC")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

// A drawing is an image that is almost entirely paper-white plus ink-dark
// pixels, with very little in between (photos have lots of mid-tones).
async function detectMode(inputPath) {
  const { data } = await sharp(inputPath)
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize(256, 256, { fit: "inside", kernel: sharp.kernel.nearest })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let extremes = 0;
  for (const v of data) if (v > 215 || v < 60) extremes++;
  return extremes / data.length > 0.95 ? "drawing" : "photo";
}

async function drawingToGameBoy(inputPath, outputPath) {
  const { data } = await sharp(inputPath)
    .rotate()
    .flatten({ background: "#ffffff" }) // transparent PNGs -> white paper
    .greyscale()
    .trim({ background: "#ffffff", threshold: 40 }) // drop empty paper margins
    .resize(GRID_W - 4, GRID_H - 4, { fit: "contain", background: "#ffffff" })
    .extend({ top: 2, bottom: 2, left: 2, right: 2, background: "#ffffff" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const ink = PALETTE[0];
  const paper = PALETTE[PALETTE.length - 1];
  const out = Buffer.alloc(GRID_W * GRID_H * 3);
  for (let i = 0; i < GRID_W * GRID_H; i++) {
    const [r, g, b] = data[i] < DRAWING_LINE_THRESHOLD ? ink : paper;
    out[i * 3] = r;
    out[i * 3 + 1] = g;
    out[i * 3 + 2] = b;
  }
  await writeBlocks(out, outputPath);
}

async function writeBlocks(rgb, outputPath) {
  await sharp(rgb, { raw: { width: GRID_W, height: GRID_H, channels: 3 } })
    .resize(GRID_W * SCALE, GRID_H * SCALE, { kernel: sharp.kernel.nearest })
    .png({ palette: true, colours: PALETTE.length, dither: 0, compressionLevel: 9 })
    .toFile(outputPath);
}

async function photoToGameBoy(inputPath, outputPath) {
  // Steps 1-2: crop to the grid, greyscale, auto-contrast.
  const { data } = await sharp(inputPath)
    .rotate() // respect phone EXIF orientation
    .resize(GRID_W, GRID_H, { fit: "cover", position: sharp.strategy.attention })
    .greyscale()
    .normalise()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Step 3: ordered dither down to 4 levels.
  const levels = PALETTE.length - 1; // 3 steps between 4 shades
  const out = Buffer.alloc(GRID_W * GRID_H * 3);
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const i = y * GRID_W + x;
      const v = Math.pow(data[i] / 255, GAMMA) * levels; // 0..3
      const threshold = (BAYER4[y % 4][x % 4] + 0.5) / 16; // 0..1
      const base = Math.floor(v);
      const idx = Math.min(levels, base + (v - base > threshold ? 1 : 0));
      const [r, g, b] = PALETTE[idx];
      out[i * 3] = r;
      out[i * 3 + 1] = g;
      out[i * 3 + 2] = b;
    }
  }

  // Step 4: blow up with hard edges, save as a tiny 4-colour PNG.
  await writeBlocks(out, outputPath);
}

async function main() {
  await mkdir(ORIGINALS_DIR, { recursive: true });
  await mkdir(IMAGES_DIR, { recursive: true });

  const photos = (await readdir(ORIGINALS_DIR))
    .filter((f) => PHOTO_EXT.has(path.extname(f).toLowerCase()))
    .sort();

  if (!photos.length) {
    console.log(`No photos in ${ORIGINALS_DIR} - put some .jpg/.png files there and re-run.`);
    return;
  }

  let made = 0;
  let skipped = 0;
  for (const photo of photos) {
    const outName = `${slug(photo)}.gb.png`;
    const outPath = path.join(IMAGES_DIR, outName);
    if (!FORCE && (await exists(outPath))) {
      skipped++;
      continue;
    }
    try {
      const inputPath = path.join(ORIGINALS_DIR, photo);
      const mode = FORCE_MODE ?? (await detectMode(inputPath));
      if (mode === "drawing") await drawingToGameBoy(inputPath, outPath);
      else await photoToGameBoy(inputPath, outPath);
      console.log(`  ${photo} -> images/${outName} (${mode})`);
      made++;
    } catch (err) {
      console.error(`  FAILED ${photo}: ${err.message}`);
    }
  }
  console.log(`Done: ${made} made, ${skipped} already existed (use --force to redo).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
