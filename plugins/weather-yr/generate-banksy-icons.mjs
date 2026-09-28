// One-time / occasional generator for weather-yr's small Banksy icons
// (Quadrant view: one before the current temperature, one before each of
// the four day-part blocks - see fetch.mjs banksyIconUrls()).
//
// Source list: banksy_figures.json (next to this file) - 33 figures and
// animals cropped out of CC-licensed / CC0 photos on Wikimedia Commons.
// Each entry has a hand-tuned `crop` box ([x0, y0, x1, y1] as fractions of
// the photo) that isolates ONE figure/animal, so the icon shows just that
// silhouette instead of a whole wall/street/room. Several entries can
// share a photo (e.g. an exhibition wall with many prints); each photo is
// downloaded only once. Attribution for every photo is in that JSON.
//
// Per icon:
//   1. extract the crop box from the (EXIF-rotated) original photo
//   2. shrink it to fit a 32x32 grid (aspect kept, padded with white)
//   3. grayscale + Otsu's automatic threshold, computed on the crop itself
//      (a fixed threshold failed on unevenly lit walls). `invert: true` for
//      light figures on dark walls; `threshold_offset` nudges it.
//   4. optional `clean_edges` ("tlr" = top/left/right): removes black blobs
//      touching those edges - frame edges and wall bits caught by the crop
//   5. despeckle: drops lone black pixels
//   6. nearest-neighbor upscale to 128px, saved as plain 8-bit RGB PNG (NOT
//      a 1-bit palette PNG - TRMNL would not render those, see README)
// These steps match the in-browser preview the crops were tuned with.
//
// Output: icons/banksy-<id>.png. Any other icons/banksy-*.png (e.g. the
// earlier whole-photo icons) are deleted so fetch.mjs only picks from this
// set. Existing files are skipped; pass --force to regenerate all.
//
//   node plugins/weather-yr/generate-banksy-icons.mjs [--force]

import sharp from "sharp";
import { writeFile, mkdir, readFile, readdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = path.join(__dirname, "icons");
const SOURCES_PATH = path.join(__dirname, "banksy_figures.json");

const GRID = 32; // "big pixels" per side
const OUTPUT_SIZE = 128; // final PNG size (4x nearest-neighbor upscale)
const USER_AGENT = "trmnl-plugins-hikmek/1.0 github.com/hikmek/trmnl_plugins";
const FORCE = process.argv.includes("--force");

// --- pure pixel helpers (grid = Uint8Array of GRID*GRID, 1 = black) --------

function otsu(values) {
  const hist = new Array(256).fill(0);
  for (const v of values) hist[Math.max(0, Math.min(255, Math.round(v)))]++;
  const n = values.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; threshold = t; }
  }
  return threshold;
}

function cleanEdges(grid, edges) {
  const isBlack = (x, y) => x >= 0 && y >= 0 && x < GRID && y < GRID && grid[y * GRID + x] === 1;
  const stack = [];
  for (let i = 0; i < GRID; i++) {
    if (edges.includes("t")) stack.push([i, 0]);
    if (edges.includes("b")) stack.push([i, GRID - 1]);
    if (edges.includes("l")) stack.push([0, i]);
    if (edges.includes("r")) stack.push([GRID - 1, i]);
  }
  while (stack.length) {
    const [x, y] = stack.pop();
    if (!isBlack(x, y)) continue;
    grid[y * GRID + x] = 0;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
}

function despeckle(grid) {
  const isBlack = (x, y) => x >= 0 && y >= 0 && x < GRID && y < GRID && grid[y * GRID + x] === 1;
  const kill = [];
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (!isBlack(x, y)) continue;
      let neighbours = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && isBlack(x + dx, y + dy)) neighbours++;
      if (neighbours <= 1) kill.push(y * GRID + x);
    }
  }
  for (const k of kill) grid[k] = 0;
}

// rgb: raw RGB bytes of the crop already resized to w x h (w, h <= GRID)
export function toGrid(rgb, w, h, opts = {}) {
  const lum = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) lum[i] = 0.2126 * rgb[i * 3] + 0.7152 * rgb[i * 3 + 1] + 0.0722 * rgb[i * 3 + 2];
  const t = otsu(lum) + (opts.threshold_offset || 0);
  const grid = new Uint8Array(GRID * GRID); // 0 = white padding
  const ox = Math.floor((GRID - w) / 2), oy = Math.floor((GRID - h) / 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = lum[y * w + x];
      grid[(y + oy) * GRID + (x + ox)] = (opts.invert ? v > t : v <= t) ? 1 : 0;
    }
  }
  if (opts.clean_edges) cleanEdges(grid, opts.clean_edges);
  despeckle(grid);
  return grid;
}

export function gridToRgb(grid) {
  const scale = OUTPUT_SIZE / GRID;
  const out = Buffer.alloc(OUTPUT_SIZE * OUTPUT_SIZE * 3, 255);
  for (let y = 0; y < OUTPUT_SIZE; y++) {
    for (let x = 0; x < OUTPUT_SIZE; x++) {
      if (grid[Math.floor(y / scale) * GRID + Math.floor(x / scale)]) out.fill(0, (y * OUTPUT_SIZE + x) * 3, (y * OUTPUT_SIZE + x) * 3 + 3);
    }
  }
  return out;
}

// --- image work ---------------------------------------------------------------

const BETWEEN_DOWNLOADS_MS = 15000; // be polite to Wikimedia between photos
const MAX_ATTEMPTS = 6;

// Wikimedia answers 429 ("Too Many Requests") when downloads come too fast.
// Wait - using its Retry-After header when given, otherwise backing off
// 30s, 60s, 120s... (max 5 min) - and try again instead of failing.
async function download(url) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (res.ok) {
      // Apply EXIF orientation once, so crop fractions match the photo as displayed.
      return sharp(Buffer.from(await res.arrayBuffer())).rotate().toBuffer();
    }
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(30000 * 2 ** (attempt - 1), 300000);
      console.log(`  ${res.status} from Wikimedia - waiting ${Math.round(waitMs / 1000)}s before retry ${attempt + 1}/${MAX_ATTEMPTS}...`);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    throw new Error(`Failed to download ${url}: ${res.status}`);
  }
}

async function makeIcon(photo, src) {
  const meta = await sharp(photo).metadata();
  const [x0, y0, x1, y1] = src.crop;
  const left = Math.round(x0 * meta.width), top = Math.round(y0 * meta.height);
  const width = Math.max(1, Math.round((x1 - x0) * meta.width)), height = Math.max(1, Math.round((y1 - y0) * meta.height));
  const scale = GRID / Math.max(width, height);
  const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
  const rgb = await sharp(photo)
    .extract({ left, top, width: Math.min(width, meta.width - left), height: Math.min(height, meta.height - top) })
    .resize(w, h, { fit: "fill" })
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer();
  const grid = toGrid(rgb, w, h, src);
  return sharp(gridToRgb(grid), { raw: { width: OUTPUT_SIZE, height: OUTPUT_SIZE, channels: 3 } }).png().toBuffer();
}

async function main() {
  const sources = JSON.parse(await readFile(SOURCES_PATH, "utf8"));
  await mkdir(ICONS_DIR, { recursive: true });

  // Remove Banksy icons that aren't part of this set (e.g. the earlier
  // whole-photo ones), so fetch.mjs only picks figures/animals.
  const wanted = new Set(sources.map((s) => `banksy-${s.id}.png`));
  for (const f of await readdir(ICONS_DIR)) {
    if (/^banksy-.+\.png$/.test(f) && !wanted.has(f)) {
      await unlink(path.join(ICONS_DIR, f));
      console.log(`Removed old icon: icons/${f}`);
    }
  }

  const photos = new Map(); // url -> rotated buffer (each photo downloaded once)
  const failedUrls = new Map(); // url -> error, so entries sharing a failed photo don't re-download it
  const failures = [];
  let made = 0;
  let downloads = 0;
  for (const src of sources) {
    const outPath = path.join(ICONS_DIR, `banksy-${src.id}.png`);
    if (!FORCE && existsSync(outPath)) {
      console.log(`Skipping (already generated): ${src.id}`);
      continue;
    }
    try {
      if (failedUrls.has(src.url)) throw failedUrls.get(src.url);
      if (!photos.has(src.url)) {
        if (downloads++) await new Promise((r) => setTimeout(r, BETWEEN_DOWNLOADS_MS));
        console.log(`Downloading: ${src.file}...`);
        try {
          photos.set(src.url, await download(src.url));
        } catch (err) {
          failedUrls.set(src.url, err);
          throw err;
        }
      }
      const png = await makeIcon(photos.get(src.url), src);
      await writeFile(outPath, png);
      made++;
      console.log(`  -> icons/banksy-${src.id}.png`);
    } catch (err) {
      console.error(`  FAILED ${src.id}: ${err.message}`);
      failures.push(src.id);
    }
  }

  console.log(`\nGenerated ${made} Banksy icon(s) in plugins/weather-yr/icons/ (${sources.length} in the set)`);
  if (failures.length) console.log(`${failures.length} failed (just re-run the script - finished icons are skipped): ${failures.join(", ")}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
