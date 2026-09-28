// Generator for lunch-lerum's NAME portraits: when a dish on the menu
// contains a person's name, fetch.mjs shows a pixelated portrait of a
// well-known person with that name as one of the dish's icons:
//   "Pasta Alfredo ..."   -> Alfredo Di Stéfano
//   "Stroganoff ..."      -> Count Alexander Stroganov (the dish's namesake)
//   "Sloppy Joes ..."     -> Joe Cocker
// Sources (public-domain photos/paintings on Wikimedia Commons, with a
// hand-tuned face `crop` [x0, y0, x1, y1] as fractions) are in
// name_portraits.json. Add an entry there + a rule in fetch.mjs
// (WORD_ICON_RULES, icon "name-<id>") for a new name, then re-run this.
//
// Faces don't survive a hard black/white threshold (they turn into blobs),
// so portraits are DITHERED instead: crop -> fit into a 32x32 grid (white
// padding) -> grayscale -> contrast stretch (2nd..98th percentile) ->
// optional `gamma` -> Floyd-Steinberg error diffusion to pure black/white
// -> 4x nearest-neighbor upscale to 128px -> plain 8-bit RGB PNG (the format
// TRMNL renders). These steps match the in-browser preview the crops were
// tuned with.
//
// Output: icons/name-<id>.png. Existing files are skipped; --force redoes all.
//
//   node plugins/lunch-lerum/generate-name-portraits.mjs [--force]

import sharp from "sharp";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = path.join(__dirname, "icons");
const SOURCES_PATH = path.join(__dirname, "name_portraits.json");
const GRID = 32;
const OUTPUT_SIZE = 128;
const USER_AGENT = "trmnl-plugins-hikmek/1.0 github.com/hikmek/trmnl_plugins";
const FORCE = process.argv.includes("--force");
const BETWEEN_DOWNLOADS_MS = 15000;
const MAX_ATTEMPTS = 6;

// Wikimedia answers 429 when downloads come too fast - wait and retry.
async function download(url) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (res.ok) return sharp(Buffer.from(await res.arrayBuffer())).rotate().toBuffer();
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(30000 * 2 ** (attempt - 1), 300000);
      console.log(`  ${res.status} from Wikimedia - waiting ${Math.round(waitMs / 1000)}s before retry ${attempt + 1}/${MAX_ATTEMPTS}...`);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    throw new Error(`Failed to download ${url}: ${res.status}`);
  }
}

// rgb: raw RGB of the crop resized to w x h. Returns a GRID*GRID array, 1 = black.
export function ditherToGrid(rgb, w, h, opts = {}) {
  const L = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = 0.2126 * rgb[i * 3] + 0.7152 * rgb[i * 3 + 1] + 0.0722 * rgb[i * 3 + 2];
  const sorted = [...L].sort((a, b) => a - b);
  const lo = sorted[Math.floor(L.length * 0.02)], hi = sorted[Math.floor(L.length * 0.98)];
  const gamma = opts.gamma ?? 1;
  for (let i = 0; i < L.length; i++) {
    const v = Math.max(0, Math.min(255, ((L[i] - lo) * 255) / Math.max(1, hi - lo)));
    L[i] = 255 * Math.pow(v / 255, gamma);
  }
  const grid = new Uint8Array(GRID * GRID);
  const ox = Math.floor((GRID - w) / 2), oy = Math.floor((GRID - h) / 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, v = L[i], nv = v < 128 ? 0 : 255, e = v - nv;
      grid[(y + oy) * GRID + (x + ox)] = nv === 0 ? 1 : 0;
      if (x + 1 < w) L[i + 1] += (e * 7) / 16;
      if (y + 1 < h) {
        if (x > 0) L[i + w - 1] += (e * 3) / 16;
        L[i + w] += (e * 5) / 16;
        if (x + 1 < w) L[i + w + 1] += e / 16;
      }
    }
  }
  return grid;
}

function gridToRgb(grid) {
  const scale = OUTPUT_SIZE / GRID;
  const out = Buffer.alloc(OUTPUT_SIZE * OUTPUT_SIZE * 3, 255);
  for (let y = 0; y < OUTPUT_SIZE; y++)
    for (let x = 0; x < OUTPUT_SIZE; x++)
      if (grid[Math.floor(y / scale) * GRID + Math.floor(x / scale)]) out.fill(0, (y * OUTPUT_SIZE + x) * 3, (y * OUTPUT_SIZE + x) * 3 + 3);
  return out;
}

async function makePortrait(photo, src) {
  const meta = await sharp(photo).metadata();
  const [x0, y0, x1, y1] = src.crop;
  const left = Math.round(x0 * meta.width), top = Math.round(y0 * meta.height);
  const width = Math.min(Math.max(1, Math.round((x1 - x0) * meta.width)), meta.width - left);
  const height = Math.min(Math.max(1, Math.round((y1 - y0) * meta.height)), meta.height - top);
  const scale = GRID / Math.max(width, height);
  const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
  const rgb = await sharp(photo).extract({ left, top, width, height }).resize(w, h, { fit: "fill" }).removeAlpha().toColourspace("srgb").raw().toBuffer();
  return sharp(gridToRgb(ditherToGrid(rgb, w, h, src)), { raw: { width: OUTPUT_SIZE, height: OUTPUT_SIZE, channels: 3 } }).png().toBuffer();
}

async function main() {
  const sources = JSON.parse(await readFile(SOURCES_PATH, "utf8"));
  await mkdir(ICONS_DIR, { recursive: true });
  let downloads = 0, made = 0;
  const failures = [];
  for (const src of sources) {
    const outPath = path.join(ICONS_DIR, `name-${src.id}.png`);
    if (!FORCE && existsSync(outPath)) {
      console.log(`Skipping (already generated): name-${src.id}`);
      continue;
    }
    try {
      if (downloads++) await new Promise((r) => setTimeout(r, BETWEEN_DOWNLOADS_MS));
      console.log(`Downloading: ${src.file} (${src.person})...`);
      await writeFile(outPath, await makePortrait(await download(src.url), src));
      made++;
      console.log(`  -> icons/name-${src.id}.png`);
    } catch (err) {
      console.error(`  FAILED ${src.id}: ${err.message}`);
      failures.push(src.id);
    }
  }
  console.log(`\nGenerated ${made} portrait(s) (${sources.length} in the set)`);
  if (failures.length) console.log(`Failed (just re-run): ${failures.join(", ")}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
