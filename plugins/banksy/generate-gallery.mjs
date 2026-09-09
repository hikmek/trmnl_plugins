// One-time / occasional gallery generator for the "banksy" plugin.
//
// Downloads real (properly CC-licensed) photos of Banksy artworks from
// Wikimedia Commons (see sources.json for full attribution) and converts
// each into a small, blocky "pixel art" PNG suitable for an e-ink display.
// The resulting images are committed to plugins/banksy/gallery/ as static
// assets - this script does NOT run on the frequent 5-minute schedule.
// Run it again manually (`node plugins/banksy/generate-gallery.mjs`)
// whenever you want to add/refresh artwork in sources.json.

import sharp from "sharp";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchWithRetry } from "../../lib/http.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GALLERY_DIR = path.join(__dirname, "gallery");
const SOURCES_PATH = path.join(__dirname, "sources.json");

const PIXEL_GRID_WIDTH = 48; // number of "big pixels" across the image width
const OUTPUT_WIDTH = 480; // final rendered width (10x upscale of the grid)
const USER_AGENT = "trmnl-plugins-hikmek/1.0 github.com/hikmek/trmnl_plugins";

async function pixelate(sourceUrl) {
  const res = await fetchWithRetry(sourceUrl, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Failed to download ${sourceUrl}: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());

  // Downscale to a tiny grid (smooth averaging), then upscale with nearest-
  // neighbor to get hard pixel-art blocks, then quantize the palette.
  const tiny = await sharp(buffer)
    .rotate() // respect EXIF orientation
    .resize({ width: PIXEL_GRID_WIDTH })
    .toBuffer();

  return sharp(tiny)
    .resize({ width: OUTPUT_WIDTH, kernel: "nearest" })
    .png({ palette: true, colors: 32, dither: 0 })
    .toBuffer();
}

async function main() {
  const sources = JSON.parse(await readFile(SOURCES_PATH, "utf8"));
  await mkdir(GALLERY_DIR, { recursive: true });

  const manifest = [];
  const failures = [];
  for (const src of sources) {
    const filename = `${src.id}.png`;
    const outPath = path.join(GALLERY_DIR, filename);
    if (existsSync(outPath)) {
      console.log(`Skipping (already generated): ${src.title} (${src.id})`);
    } else {
      console.log(`Pixelating: ${src.title} (${src.id})...`);
      try {
        const png = await pixelate(src.url);
        await writeFile(outPath, png);
        console.log(`  -> gallery/${filename} (${png.length} bytes)`);
        await new Promise((r) => setTimeout(r, 10000)); // be polite to Wikimedia between downloads
      } catch (err) {
        console.error(`  FAILED: ${err.message}`);
        failures.push(src.id);
        continue; // don't add to manifest, and don't count towards the delay
      }
    }
    manifest.push({
      id: src.id,
      file: filename,
      title: src.title,
      location: src.location,
      license: src.license,
      attribution: src.attribution,
      source_page: src.source_page,
    });
  }

  await writeFile(
    path.join(GALLERY_DIR, "manifest.json"),
    JSON.stringify(manifest, null, 2)
  );
  console.log(`\nWrote ${manifest.length} images + manifest.json to plugins/banksy/gallery/`);
  if (failures.length) {
    console.log(
      `${failures.length} image(s) failed and were skipped this run (re-run the script later to fill them in): ${failures.join(", ")}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
