// TRMNL Plugin #6: Pictures rotator (+ handwritten Game Boy clock)
//
// Uses the PNGs in plugins/pictures/images/ (your own files - just drop
// them in and commit; the folder IS the list) and writes:
//
//   public/pictures/slots/0000.json ... 2359.json  <- what TRMNL polls
//   public/pictures/data.json                      <- older single-file feed
//
// Why one file per minute of the day: TRMNL only renders a new screen when
// the polled data has CHANGED. If we relied on this script re-running every
// few minutes, the clock would freeze whenever GitHub delays or drops the
// scheduled workflow (which happens - sometimes for hours). Instead TRMNL's
// polling URL includes the current time:
//
//   https://hikmek.github.io/trmnl_plugins/pictures/slots/{{ "now" | date: "%H%M" }}.json
//
// so every poll fetches a different file -> data always changed -> a fresh
// screen (and clock) on every refresh, even if this script hasn't run for a
// day. What to show is baked into the files, per 15-minute block of the day:
//
//   MODE = "walk"   -> the walking-bird flipbook (walk/frame-*.png, made by
//                      generate-walk.mjs), one frame per block, in order.
//                      24 frames = one walk across the screen every 6 hours.
//   MODE = "random" -> a random picture from images/ per block, never the
//                      same as the block before.
// ("now" on TRMNL's side is UTC, but that doesn't matter - all 1440 minutes
// exist, the file name is just a key.)

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
const SLOT_MINUTES = 15; // a new picture / walk frame every 15 minutes
const MODE = "walk"; // "walk" or "random" (see top of file)
const WALK_DIR = path.join(__dirname, "walk");
const WALK_BASE_URL = `${PUBLIC_BASE_URL}/walk`;
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

// Publish the walk frames to public/pictures/walk/ (same reason as digits).
async function publishWalk() {
  const out = path.join(PUBLIC_DIR, "walk");
  await mkdir(out, { recursive: true });
  let frames = [];
  try {
    frames = (await readdir(WALK_DIR)).filter((f) => /^frame-\d+\.png$/.test(f)).sort();
  } catch {
    return [];
  }
  for (const f of frames) await copyFile(path.join(WALK_DIR, f), path.join(out, f));
  return frames;
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

  const pickOther = (avoid) => {
    const others = files.filter((f) => !avoid.includes(f));
    const pool = others.length ? others : files;
    return pool[Math.floor(Math.random() * pool.length)];
  };

  const now = Date.now();
  const common = {
    plugin: "pictures",
    generated_at: new Date(now).toISOString(), // the template shows this as "Data uppdaterad kl ..."
    updated_display: formatUpdatedDisplay(now), // pre-formatted (older templates)
    digits_url: DIGITS_BASE_URL, // + "/0.png" ... "/9.png", "/colon.png"
    gallery_size: files.length,
  };
  const pictureFields = (file) => ({
    image_url: `${IMAGES_BASE_URL}/${encodeURIComponent(file)}`,
    file,
    title: titleFromFile(file),
    index: files.indexOf(file) + 1,
  });

  // One random picture per 15-minute block, never the same as the block
  // before (the last block of the day also avoids the first, for midnight).
  const blockCount = (24 * 60) / SLOT_MINUTES;
  const blocks = [];
  for (let b = 0; b < blockCount; b++) {
    const avoid = [blocks[b - 1]];
    if (b === blockCount - 1 && files.length > 2) avoid.push(blocks[0]);
    blocks.push(pickOther(avoid.filter(Boolean)));
  }

  // Walk mode: block b shows walk frame (b mod frameCount) instead.
  const walkFrames = await publishWalk();
  const walking = MODE === "walk" && walkFrames.length > 0;
  if (MODE === "walk" && !walking) console.warn("MODE is walk but no walk frames found - showing random pictures");
  const blockFields = (b) =>
    walking
      ? {
          image_url: `${WALK_BASE_URL}/${walkFrames[b % walkFrames.length]}`,
          file: walkFrames[b % walkFrames.length],
          title: "",
          index: (b % walkFrames.length) + 1,
          gallery_size: walkFrames.length,
        }
      : pictureFields(blocks[b]);

  // One file per minute: slots/HHMM.json. The "slot" field makes every file
  // different, so TRMNL always sees changed data and re-renders.
  const slotsDir = path.join(PUBLIC_DIR, "slots");
  await mkdir(slotsDir, { recursive: true });
  for (let m = 0; m < 24 * 60; m++) {
    const hhmm = `${String(Math.floor(m / 60)).padStart(2, "0")}${String(m % 60).padStart(2, "0")}`;
    const slot = { ...common, slot: hhmm, ...blockFields(Math.floor(m / SLOT_MINUTES)) };
    await writeFile(path.join(slotsDir, `${hhmm}.json`), JSON.stringify(slot));
  }
  console.log(`Wrote ${24 * 60} slot files to ${slotsDir} (${walking ? `walk, ${walkFrames.length} frames` : "random pictures"})`);

  // The older single-file feed (still works, but only changes when this
  // script runs): random picture, avoiding the one currently published.
  const previous = await getPreviousFile();
  const output = { ...common, ...pictureFields(pickOther([previous])) };
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`Wrote ${OUTPUT_PATH}`);
  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
