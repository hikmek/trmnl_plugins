// Generator for weather-yr's rain-forecast icons (Quadrant view, bottom
// row - replaces the old rain_forecast_text there). Two icons side by side:
//   icons/witch.png   - a witch (pointy hat, long nose with a wart); always
//                       shown, rain or not
//   icons/rain.png    - rain cloud: raining now, or rain starting within
//                       the next 60 minutes
//   icons/no-rain.png - crossed-out raindrop: no rain expected in the next
//                       60 minutes
// fetch.mjs sets current.witch_icon_url and current.rain_status_icon_url.
//
// Original pixel art, drawn directly as 32x32 grids below ('#' = black)
// so they're easy to tweak by hand. Upscaled 4x (nearest-neighbor) to
// 128px and written as plain 8-bit RGB PNGs - the format TRMNL actually
// renders (see "1-bit PNG" in README.md). No `sharp` needed: this uses a
// tiny built-in PNG encoder (node:zlib), so it runs anywhere Node does.
//
//   node plugins/weather-yr/generate-rain-icons.mjs

import { writeFile, mkdir } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = path.join(__dirname, "icons");
const SCALE = 4; // 32 -> 128px

const ICONS = {
  "witch": [
    "......................#.........",
    "....................##..........",
    ".................####...........",
    "................####............",
    "...............#####............",
    "..............#####.............",
    ".............######.............",
    "............########............",
    "...........#########............",
    "...........##########...........",
    "................................",
    ".........#############..........",
    "..############################..",
    ".##############################.",
    ".....#.#.#.#........#...........",
    ".....#.#.#.#..##.....#..........",
    ".....#.#.#.#....###..#...##.....",
    ".....#.#.#.#....##...#...##.....",
    ".....#.#.#.#....##...#######....",
    "....#.#.#.#..........#####......",
    "....#.#.#.#...........######....",
    "....#.#.#.#............#######..",
    "....#.#.#.#...........#..######.",
    "....#.#.#.#...........#......##.",
    "....#.#.#.#...........#.........",
    "....#.#.#.#........####.........",
    "....#.#.#.##..........#.........",
    "...#.#.#.#.#...........##.......",
    "...#.#.#.#.#.............##.....",
    "...#.#.#.#..#..............##...",
    "...#.#.#.#..#.............##....",
    "...#.#.#.#...#############......"
  ],
  "rain": [
    "................................",
    "................................",
    "..............#####.............",
    ".............#######............",
    "............#########...........",
    "...........###########..........",
    ".......###################......",
    "......#####################.....",
    ".....#######################....",
    "....#########################...",
    "....#########################...",
    "....#########################...",
    "....#########################...",
    ".....#######################....",
    "......#####################.....",
    ".......###################......",
    ".......###################......",
    "................................",
    "........#.....#.....#.....#.....",
    "........#.....#.....#.....#.....",
    ".......#.....#.....#.....#......",
    ".......#.....#.....#.....#......",
    "......#.....#.....#.....#.......",
    "......#.....#.....#.....#.......",
    "...........#.....#.....#........",
    "...........#.....#.....#........",
    "..........#.....#.....#.........",
    "..........#.....#.....#.........",
    ".........#.....#.....#..........",
    ".........#.....#.....#..........",
    "................................",
    "................................"
  ],
  "no-rain": [
    "................................",
    "................................",
    "................................",
    "................#...........###.",
    "...............###.........###..",
    "...............###........###...",
    "..............#####......###....",
    "..............#####.....###.....",
    ".............#######...###......",
    "............########..###.......",
    "............#######..###........",
    "...........#######..###.........",
    "...........######..###..........",
    "..........######..###...........",
    "..........#####..###..#.........",
    ".........#####..###..###........",
    ".........####..###..####........",
    "........####..###..######.......",
    "........###..###..#######.......",
    "........##..###..########.......",
    "........#..###..#########.......",
    "..........###..#########........",
    ".........###..##########........",
    "........###...##########........",
    ".......###..###########.........",
    "......###..###########..........",
    ".....###...###########..........",
    "....###.....#########...........",
    "...###..........#...............",
    "..###...........................",
    "................................",
    "................................"
  ],};

// --- minimal PNG encoder (8-bit RGB, no interlace) -------------------------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function gridToPng(rows) {
  const size = rows.length * SCALE;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  const raw = Buffer.alloc(size * (1 + size * 3), 255);
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 3);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      if (rows[Math.floor(y / SCALE)][Math.floor(x / SCALE)] === "#") raw.fill(0, rowStart + 1 + x * 3, rowStart + 4 + x * 3);
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function main() {
  await mkdir(ICONS_DIR, { recursive: true });
  for (const [name, rows] of Object.entries(ICONS)) {
    if (rows.length !== 32 || rows.some((r) => r.length !== 32)) throw new Error(`${name}: grid must be 32x32`);
    await writeFile(path.join(ICONS_DIR, `${name}.png`), gridToPng(rows));
    console.log(`Wrote icons/${name}.png`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
