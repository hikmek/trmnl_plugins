// TRMNL Plugin #4: Banksy pixel art rotator
//
// Picks a random pre-generated pixel-art image from plugins/banksy/gallery/
// (see generate-gallery.mjs for how those PNGs are made) and writes a tiny
// JSON pointing TRMNL at the chosen image's public URL. This script is
// intentionally lightweight (no image processing, no external network
// calls) since it's meant to run every 5 minutes.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.join(__dirname, "gallery", "manifest.json");
const OUTPUT_PATH = path.join(__dirname, "..", "..", "public", "banksy", "data.json");

const PUBLIC_BASE_URL = "https://hikmek.github.io/trmnl_plugins/banksy/gallery";

async function main() {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  if (!manifest.length) {
    throw new Error("gallery/manifest.json is empty - run generate-gallery.mjs first");
  }

  const pick = manifest[Math.floor(Math.random() * manifest.length)];

  const output = {
    plugin: "banksy",
    generated_at: new Date().toISOString(),
    image_url: `${PUBLIC_BASE_URL}/${pick.file}`,
    title: pick.title,
    location: pick.location,
    license: pick.license,
    attribution: pick.attribution,
    source_page: pick.source_page,
    gallery_size: manifest.length,
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`Wrote ${OUTPUT_PATH}`);
  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
