// TRMNL Plugin #6: Pictures rotator
//
// Picks a random PNG from plugins/pictures/images/ (your own files - just
// drop them in and commit) and writes a tiny JSON pointing TRMNL at the
// chosen image's public URL. No manifest to maintain: the folder IS the
// list. No external network calls apart from one cheap read of our own
// last-published data.json, used to avoid showing the same picture twice
// in a row. Meant to run every cycle (every 5 minutes).

import { readdir, writeFile, mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatUpdatedDisplay } from "../../lib/format.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMAGES_DIR = path.join(__dirname, "images");
const DIGITS_DIR = path.join(__dirname, "digits");
const PUBLIC_DIR = path.join(__dirname, "..", "..", "public", "pictures");
const OUTPUT_PATH = path.join(PUBLIC_DIR, "data.json");

const PUBLIC_BASE_URL = "https://hikmek.github.io/trmnl_plugins/pictures";
const IMAGES_BASE_URL = `${PUBLIC_BASE_URL}/images`;
const LIVE_DATA_URL = `${PUBLIC_BASE_URL}/data.json`;
const DIGITS_BASE_URL = `${PUBLIC_BASE_URL}/digits`;

// Publish the clock digits (0.png-9.png, colon.png made by
// generate-digits.mjs) to public/pictures/digits/. Done here rather than in
// the workflow so adding the clock didn't need a workflow change. Runs
// first, so the digits are published even if picking a picture fails.
async function publishDigits() {
  const out = path.join(PUBLIC_DIR, "digits");
  await mkdir(out, { recursive: true });
  const files = (await readdir(DIGITS_DIR)).filter((f) => /^(\d|colon)\.png$/.test(f));
  for (const f of files) await copyFile(path.join(DIGITS_DIR, f), path.join(out, f));
  return files.length;
}

// "my-summer_photo.pixel-4bit.png" / "my-summer_photo.gb.png" -> "my summer photo"
// Screenshots and number-only names get no caption - the
// template shows a generic title instead.
function titleFromFile(file) {
  const name = path.parse(file).name.replace(/\.(pixel-[\w-]+|gb)$/i, "");
  // Number-only names ("1", "2024-06") make useless captions too.
  if (/^screenshot\b/i.test(name) || /^[\d\s_-]+$/.test(name)) return "";
  return name.replace(/[-_]+/g, " ").trim();
}

// Which file did the last published data.json show? Best effort only -
// any failure just means we can't avoid a repeat this time.
async function getPreviousFile() {
  try {
    const res = await fetch(LIVE_DATA_URL, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const json = await res.json();
    return typeof json.file === "string" ? json.file : null;
  } catch {
    return null;
  }
}

async function main() {
  const digitCount = await publishDigits();
  if (digitCount < 11) console.warn(`Only ${digitCount}/11 clock digits found - run generate-digits.mjs`);

  const files = (await readdir(IMAGES_DIR))
    .filter((f) => f.toLowerCase().endsWith(".png"))
    .sort();

  if (!files.length) {
    throw new Error(`No .png files in ${IMAGES_DIR} - add some pictures first`);
  }

  const previous = await getPreviousFile();
  const candidates = files.length > 1 ? files.filter((f) => f !== previous) : files;
  const pick = candidates[Math.floor(Math.random() * candidates.length)];

  const now = Date.now();
  const output = {
    plugin: "pictures",
    generated_at: new Date(now).toISOString(),
    updated_display: formatUpdatedDisplay(now), // "Data uppdaterad kl 14:55 idag"
    digits_url: DIGITS_BASE_URL, // + "/0.png" ... "/9.png", "/colon.png"
    image_url: `${IMAGES_BASE_URL}/${encodeURIComponent(pick)}`,
    file: pick,
    title: titleFromFile(pick),
    index: files.indexOf(pick) + 1,
    gallery_size: files.length,
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
