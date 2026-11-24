// Cuts the clock digits 0-9 out of your handwritten number sheet and turns
// them into Game Boy pixel art matching the birds.
//
// Run manually (NOT part of the recurring workflow), only when the sheet or
// the settings below change:
//
//   node plugins/pictures/generate-digits.mjs
//
// Input:  plugins/pictures/digits/source.png  (your sheet of numbers)
// Output: plugins/pictures/digits/0.png ... 9.png and colon.png
//
// Steps per digit, same idea as the drawings in generate-pictures.mjs:
//   1. Cut the digit out of the sheet (boxes in DIGIT_BOXES below - all
//      mostly from the "01 ... 09" rows, so the digits share pen and size).
//   2. Shrink it to DIGIT_HEIGHT big pixels tall; every big pixel the pen
//      touched becomes black.
//   3. Thin the strokes down to 1 big pixel wide (Zhang-Suen thinning) so
//      they have the same line weight as the pixelated birds.
//   4. Blow up x SCALE with hard edges (3 = the same block size as the birds).
//
// fetch.mjs copies the finished digits to GitHub Pages on every run, so no
// workflow change is needed.

import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIGITS_DIR = path.join(__dirname, "digits");
const SOURCE = path.join(DIGITS_DIR, "source.png");

const DIGIT_HEIGHT = 20; // big pixels tall (x3 = 60 px on screen)
const SCALE = 3; // same block size as the Game Boy birds
const INK_THRESHOLD = 150; // sheet pixel darker than this = pen
const SHRINK_THRESHOLD = 215; // shrunken big pixel darker than this = pen
const PAD_X = 1; // white big pixels left/right of each digit (= letter spacing)
const PAD_Y = 2; // white big pixels above/below

// Where each digit sits on the sheet: [top, bottom, left, right] in sheet
// pixels. Taken from "05", "01", "20", "03", "04", "05", "06", "07", "18", "09"
// (the cleanest, most open-looped version of each digit on the sheet).
const DIGIT_BOXES = {
  0: [397, 422, 224, 246],
  1: [314, 339, 369, 373],
  2: [323, 353, 53, 80],
  3: [401, 428, 80, 107],
  4: [401, 428, 171, 192],
  5: [393, 421, 260, 287],
  6: [390, 423, 346, 365],
  7: [387, 421, 431, 455],
  8: [219, 250, 361, 382],
  9: [481, 513, 181, 204],
};

const BLACK = 0;
const WHITE = 255;

// Zhang-Suen thinning on a 0/1 grid (1 = ink). Reduces strokes to 1 pixel
// wide while keeping them connected.
function thin(grid, w, h) {
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : grid[y * w + x]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const pass of [0, 1]) {
      const remove = [];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!at(x, y)) continue;
          const p = [at(x, y - 1), at(x + 1, y - 1), at(x + 1, y), at(x + 1, y + 1),
            at(x, y + 1), at(x - 1, y + 1), at(x - 1, y), at(x - 1, y - 1)];
          const b = p.reduce((s, v) => s + v, 0);
          if (b < 2 || b > 6) continue;
          let a = 0;
          for (let i = 0; i < 8; i++) if (!p[i] && p[(i + 1) % 8]) a++;
          if (a !== 1) continue;
          const [p2, , p4, , p6, , p8] = p;
          if (pass === 0 ? p2 * p4 * p6 || p4 * p6 * p8 : p2 * p4 * p8 || p2 * p6 * p8) continue;
          remove.push(y * w + x);
        }
      }
      for (const i of remove) grid[i] = 0;
      if (remove.length) changed = true;
    }
  }
  return grid;
}

async function writeGrid(grid, w, h, file) {
  const px = Buffer.alloc(w * h);
  for (let i = 0; i < w * h; i++) px[i] = grid[i] ? BLACK : WHITE;
  await sharp(px, { raw: { width: w, height: h, channels: 1 } })
    .resize(w * SCALE, h * SCALE, { kernel: sharp.kernel.nearest })
    .png({ palette: true, colours: 2, dither: 0, compressionLevel: 9 })
    .toFile(path.join(DIGITS_DIR, file));
}

async function makeDigit(digit, [top, bottom, left, right]) {
  // 1. Cut out, keep only the pen strokes (everything else -> white).
  const cut = await sharp(SOURCE)
    .extract({ left, top, width: right - left, height: bottom - top })
    .greyscale()
    .threshold(INK_THRESHOLD)
    .toBuffer();

  // 2. Shrink to the digit height; any pen in a big pixel -> black.
  const { data, info } = await sharp(cut)
    .resize({ height: DIGIT_HEIGHT })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const iw = info.width;
  const w = iw + PAD_X * 2;
  const h = DIGIT_HEIGHT + PAD_Y * 2;
  const grid = new Uint8Array(w * h);
  for (let y = 0; y < DIGIT_HEIGHT; y++) {
    for (let x = 0; x < iw; x++) {
      if (data[(y * iw + x) * info.channels] < SHRINK_THRESHOLD) grid[(y + PAD_Y) * w + x + PAD_X] = 1;
    }
  }

  // 3. Thin to 1-pixel strokes.  4. Scale up and save.
  thin(grid, w, h);
  await writeGrid(grid, w, h, `${digit}.png`);
  console.log(`  digits/${digit}.png  (${w}x${h} big pixels)`);
}

// A colon made of two 2x2 pen dots, same height as the digits.
async function makeColon() {
  const w = 2 + PAD_X * 2 + 2; // a little extra air around the colon
  const h = DIGIT_HEIGHT + PAD_Y * 2;
  const grid = new Uint8Array(w * h);
  for (const top of [Math.round(DIGIT_HEIGHT * 0.3), Math.round(DIGIT_HEIGHT * 0.7)]) {
    for (let y = top; y < top + 2; y++) for (let x = 0; x < 2; x++) grid[(y + PAD_Y) * w + x + PAD_X + 1] = 1;
  }
  await writeGrid(grid, w, h, "colon.png");
  console.log("  digits/colon.png");
}

async function main() {
  for (const [digit, box] of Object.entries(DIGIT_BOXES)) await makeDigit(digit, box);
  await makeColon();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
