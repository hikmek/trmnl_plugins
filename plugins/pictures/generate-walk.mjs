// Makes your bird drawing WALK: a flipbook of Game Boy pixel-art frames,
// one frame per TRMNL refresh (see SLOT_MINUTES in fetch.mjs).
//
// Run manually (NOT part of the recurring workflow) when the drawing or the
// settings below change:
//
//   node plugins/pictures/generate-walk.mjs
//
// Input:  plugins/pictures/walk/source.png   (your bird, facing left)
// Output: plugins/pictures/walk/frame-00.png ... frame-23.png
//
// How: the body (everything above the hips, HIP_Y) is kept exactly as you
// drew it. The legs are cut off and redrawn as stick legs with the same
// three-toed feet, in a classic 4-phase walk cycle:
//
//   0  front leg forward, back leg behind (both feet on the ground)
//   1  front leg straight under the body, back leg lifted and swinging
//   2  back leg forward, front leg behind
//   3  back leg straight under the body, front leg lifted and swinging
//
// The arm (the line with the little hand inside the body) swings opposite
// to the legs, like a real walk, and on a few frames (BLINK_FRAMES) the eye
// is closed - a blink "from time to time".
//
// Planted feet never slide, the body dips a little when the legs are
// spread (legs keep their length), and the bird moves left STEP px per
// frame - in FRAMES frames it walks in from the right edge and out at the
// left. Each frame is then pixelated exactly like the drawings in
// generate-pictures.mjs: 160x144 Game Boy grid, 1-pixel lines, x3 blocks.

import sharp from "sharp";
import { mkdir, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WALK_DIR = path.join(__dirname, "walk");
const SOURCE = path.join(WALK_DIR, "source.png");

// --- Measured on your drawing (source pixels) ---
const HIP_Y = 886; // body/legs cut line
const HIPS = [334, 421]; // x of front (left) and back (right) hip
const LEG = 308; // hip -> ankle length
const ANKLE_Y = 1195; // ankle height when standing on the ground
const BIRD_LEFT = 111; // beak tip x
const BIRD_RIGHT = 537; // back x
// Toes relative to the ankle: on the ground, and dangling when lifted.
const TOES_DOWN = [[-30, 45], [0, 45], [27, 52]];
const TOES_LIFTED = [[-22, 44], [-2, 48], [16, 44]];
// The arm: every pen pixel in this box, swung around the shoulder.
const ARM_BOX = { x0: 345, x1: 436, y0: 435, y1: 772 };
const SHOULDER = [426, 442];
// The eye: the oval and the pupil, inside this ellipse.
const EYE = { cx: 368, cy: 91, rx: 68, ry: 58 };
const LINE_RADIUS = 2.5; // pen thickness (~5 px, like the pencil lines)
const INK = 160; // source pixel darker than this = pen

// --- Walk settings ---
const FRAMES = 24; // 24 x 15 min = one walk across the screen every 6 hours
const LIFT = 45; // how high a swinging foot is lifted
const ARM_SWING = 14; // degrees the arm swings back/forward
const BLINK_FRAMES = [4, 11, 17, 22]; // frames with the eye closed

// --- Game Boy grid, same as generate-pictures.mjs ---
const GRID_W = 160;
const GRID_H = 144;
const SCALE = 3;
const SCENE_H = 1300; // source px shown top-to-bottom (bird is ~1245 tall)
const CELL = SCENE_H / GRID_H; // source px per Game Boy pixel
const SCENE_W = Math.round(GRID_W * CELL);
const COVERAGE = 0.08; // a Game Boy pixel is black if >= 8% of it is pen

// Walk from "beak just in from the right" to "tail just out at the left".
const START_X = SCENE_W - 200 - BIRD_LEFT;
const END_X = 150 - BIRD_RIGHT;
const STEP = (START_X - END_X) / (FRAMES - 1); // body move per frame
const HALF_STRIDE = STEP; // foot offset from hip at contact

function stampLine(scene, x0, y0, x1, y1) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(1, Math.ceil(len));
  const r = LINE_RADIUS;
  for (let i = 0; i <= n; i++) {
    const cx = x0 + ((x1 - x0) * i) / n;
    const cy = y0 + ((y1 - y0) * i) / n;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if (x < 0 || y < 0 || x >= SCENE_W || y >= SCENE_H) continue;
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) scene[y * SCENE_W + x] = 1;
      }
    }
  }
}

function drawFoot(scene, ax, ay, toes) {
  for (const [dx, dy] of toes) stampLine(scene, ax, ay, ax + dx, ay + dy);
}

// Bent leg (lifted): knee bends forward (towards -x, the walking direction).
function drawBentLeg(scene, hx, hy, ax, ay) {
  const d = Math.hypot(ax - hx, ay - hy);
  const half = LEG / 2;
  const h = Math.sqrt(Math.max(0, half * half - (d / 2) ** 2));
  const mx = (hx + ax) / 2;
  const my = (hy + ay) / 2;
  // unit perpendicular to hip->ankle, pick the one pointing to -x
  let px = -(ay - hy) / d;
  let py = (ax - hx) / d;
  if (px > 0) [px, py] = [-px, -py];
  const kx = mx + px * h;
  const ky = my + py * h;
  stampLine(scene, hx, hy, kx, ky);
  stampLine(scene, kx, ky, ax, ay);
}

function inArm(x, y) {
  return x >= ARM_BOX.x0 && x < ARM_BOX.x1 && y >= ARM_BOX.y0 && y < ARM_BOX.y1;
}
function inEye(x, y) {
  return ((x - EYE.cx) / EYE.rx) ** 2 + ((y - EYE.cy) / EYE.ry) ** 2 <= 1;
}

// Closed eye: a soft "smile" curve across where the eye was.
function drawClosedEye(scene, ox, oy) {
  const [x0, y0, cx, cy, x1, y1] = [
    EYE.cx - EYE.rx + 6, EYE.cy - 4, EYE.cx, EYE.cy + 34, EYE.cx + EYE.rx - 6, EYE.cy - 4,
  ];
  let px = x0;
  let py = y0;
  for (let i = 1; i <= 24; i++) {
    const t = i / 24;
    const qx = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t * t * x1;
    const qy = (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t * t * y1;
    stampLine(scene, px + ox, py + oy, qx + ox, qy + oy);
    px = qx;
    py = qy;
  }
}

async function main() {
  const { data, info } = await sharp(SOURCE)
    .flatten({ background: "#ffffff" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const SW = info.width;
  const SH = info.height;

  // Old frames out (the frame count may have changed).
  await mkdir(WALK_DIR, { recursive: true });
  for (const f of await readdir(WALK_DIR)) if (/^frame-\d+\.png$/.test(f)) await unlink(path.join(WALK_DIR, f));

  for (let k = 0; k < FRAMES; k++) {
    const phase = k % 4;
    const bx = START_X - k * STEP;

    // Where each foot is, relative to its own hip (x), and whether it's lifted.
    //   leg 0 = front, leg 1 = back
    const feet = [
      [[-HALF_STRIDE, false], [0, false], [HALF_STRIDE, false], [-10, true]][phase],
      [[HALF_STRIDE, false], [-10, true], [-HALF_STRIDE, false], [0, false]][phase],
    ];
    // Body height: the planted legs keep their length, so spread legs = lower hips.
    const spread = Math.max(...feet.filter(([, up]) => !up).map(([dx]) => Math.abs(dx)));
    const hipY = ANKLE_Y - Math.sqrt(LEG * LEG - spread * spread);
    const by = hipY - HIP_Y;

    const scene = new Uint8Array(SCENE_W * SCENE_H);

    const blink = BLINK_FRAMES.includes(k);
    const ink = (x, y) => x >= 0 && y >= 0 && x < SW && y < SH && data[y * SW + x] < INK;
    const put = (x, y) => {
      const tx = Math.round(x + bx);
      const ty = Math.round(y + by);
      if (tx >= 0 && ty >= 0 && tx < SCENE_W && ty < SCENE_H) scene[ty * SCENE_W + tx] = 1;
    };

    // Body: your drawing above the hip line, moved to (bx, by) - minus the
    // arm (drawn swung below) and, when blinking, minus the open eye.
    for (let y = 0; y < Math.min(HIP_Y, SH); y++) {
      for (let x = 0; x < SW; x++) {
        if (!ink(x, y) || inArm(x, y) || (blink && inEye(x, y))) continue;
        put(x, y);
      }
    }
    if (blink) drawClosedEye(scene, bx, by);

    // Arm: swings opposite to the legs. Positive angle = hand forward (-x).
    // Phase 0 (front leg forward) -> arm back; phase 2 -> arm forward.
    const armDeg = [-ARM_SWING, 0, ARM_SWING, 0][phase];
    const a = (armDeg * Math.PI) / 180;
    const [sx, sy] = SHOULDER;
    const reach = Math.hypot(ARM_BOX.y1 - sy, ARM_BOX.x1 - ARM_BOX.x0) + 10;
    for (let y = Math.floor(sy - 10); y <= Math.ceil(sy + reach); y++) {
      for (let x = Math.floor(sx - reach); x <= Math.ceil(sx + reach); x++) {
        // inverse-rotate the target pixel back into the drawing
        const dx = x - sx;
        const dy = y - sy;
        const ux = Math.round(sx + Math.cos(a) * dx + Math.sin(a) * dy);
        const uy = Math.round(sy - Math.sin(a) * dx + Math.cos(a) * dy);
        if (inArm(ux, uy) && ink(ux, uy)) put(x, y);
      }
    }

    // Legs + feet.
    feet.forEach(([dx, lifted], leg) => {
      const hx = HIPS[leg] + bx;
      const ax = hx + dx;
      if (lifted) {
        const ay = ANKLE_Y - LIFT;
        drawBentLeg(scene, hx, hipY, ax, ay);
        drawFoot(scene, ax, ay, TOES_LIFTED);
      } else {
        stampLine(scene, hx, hipY, ax, ANKLE_Y);
        drawFoot(scene, ax, ANKLE_Y, TOES_DOWN);
      }
    });

    // Pixelate: each Game Boy pixel is black if enough pen falls inside it.
    const grid = Buffer.alloc(GRID_W * GRID_H);
    for (let gy = 0; gy < GRID_H; gy++) {
      const y0 = Math.floor(gy * CELL);
      const y1 = Math.floor((gy + 1) * CELL);
      for (let gx = 0; gx < GRID_W; gx++) {
        const x0 = Math.floor(gx * CELL);
        const x1 = Math.floor((gx + 1) * CELL);
        let ink = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) ink += scene[y * SCENE_W + x];
        grid[gy * GRID_W + gx] = ink / ((x1 - x0) * (y1 - y0)) >= COVERAGE ? 0 : 255;
      }
    }

    const name = `frame-${String(k).padStart(2, "0")}.png`;
    await sharp(grid, { raw: { width: GRID_W, height: GRID_H, channels: 1 } })
      .resize(GRID_W * SCALE, GRID_H * SCALE, { kernel: sharp.kernel.nearest })
      .png({ palette: true, colours: 2, dither: 0, compressionLevel: 9 })
      .toFile(path.join(WALK_DIR, name));
    console.log(`  walk/${name}  (phase ${phase})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
