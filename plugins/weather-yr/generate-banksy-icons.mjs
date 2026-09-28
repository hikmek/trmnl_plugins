// One-time / occasional generator for weather-yr's small Banksy icons
// (Quadrant view: one before the current temperature, one before each of
// the four day-part blocks - see fetch.mjs banksyIconUrls()).
//
// Uses the SAME CC-licensed Wikimedia Commons photos as plugins/banksy
// (reads ../banksy/sources.json, so adding artwork there also adds it
// here on the next run) but makes FINER, square icons instead of the
// banksy plugin's coarse 24-wide gallery images:
//   - center-cropped to a square (the photos are all landscape/portrait)
//   - 32x32 grid (vs banksy's 24 across) - same grid size as this plugin's
//     own weather/clothing pixel-art icons, so they match visually
//   - hard black/white threshold (stencil look), nearest-neighbor upscale
//     to 128px
//   - saved as plain 8-bit RGB PNG, NOT a 1-bit palette PNG like the
//     banksy gallery - TRMNL would not render 1-bit PNGs in this plugin
//     (see "1-bit PNG bug" in README.md)
//
// Output: icons/banksy-<id>.png. fetch.mjs discovers whichever of these
// exist at run time, so failed downloads just mean fewer icons to pick
// from. Existing files are skipped; delete one to regenerate it.
//
//   node plugins/weather-yr/generate-banksy-icons.mjs

import sharp from "sharp";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchWithRetry } from "../../lib/http.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = path.join(__dirname, "icons");
const SOURCES_PATH = path.join(__dirname, "..", "banksy", "sources.json");

const GRID = 32; // "big pixels" per side - raise for finer, lower for coarser
const OUTPUT_SIZE = 128; // final PNG size (4x nearest-neighbor upscale)
const CONTRAST_THRESHOLD = 128; // 0-255: below -> black, at/above -> white
const USER_AGENT = "trmnl-plugins-hikmek/1.0 github.com/hikmek/trmnl_plugins";

async function makeIcon(sourceUrl) {
  const res = await fetchWithRetry(sourceUrl, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Failed to download ${sourceUrl}: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());

  const tiny = await sharp(buffer)
    .rotate() // respect EXIF orientation
    .resize(GRID, GRID, { fit: "cover", position: "attention" }) // square crop on the most "interesting" region
    .greyscale()
    .normalize()
    .threshold(CONTRAST_THRESHOLD)
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Expand the 1-channel result to a 3-channel buffer so the PNG is 8-bit
  // RGB (same format as generate-icons.mjs / broforce's portraits).
  const { data, info } = tiny;
  const rgb = Buffer.alloc(info.width * info.height * 3);
  for (let i = 0; i < info.width * info.height; i++) {
    const v = data[i * info.channels];
    rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = v;
  }

  return sharp(rgb, { raw: { width: info.width, height: info.height, channels: 3 } })
    .resize(OUTPUT_SIZE, OUTPUT_SIZE, { kernel: "nearest" })
    .png()
    .toBuffer();
}

async function main() {
  const sources = JSON.parse(await readFile(SOURCES_PATH, "utf8"));
  await mkdir(ICONS_DIR, { recursive: true });

  const failures = [];
  let made = 0;
  for (const src of sources) {
    const outPath = path.join(ICONS_DIR, `banksy-${src.id}.png`);
    if (existsSync(outPath)) {
      console.log(`Skipping (already generated): ${src.id}`);
      continue;
    }
    console.log(`Pixelating: ${src.title} (${src.id})...`);
    try {
      const png = await makeIcon(src.url);
      await writeFile(outPath, png);
      made++;
      console.log(`  -> icons/banksy-${src.id}.png (${png.length} bytes)`);
      await new Promise((r) => setTimeout(r, 10000)); // be polite to Wikimedia between downloads
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
      failures.push(src.id);
    }
  }

  console.log(`\nGenerated ${made} new Banksy icon(s) in plugins/weather-yr/icons/`);
  if (failures.length) {
    console.log(`${failures.length} failed (re-run later to fill them in): ${failures.join(", ")}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
