// One-time / occasional generator for the "broforce" plugin's portraits.
//
// Source images (sources/1.png .. 9.png) are reference sheets - each one a
// screenshot compiling several BROFORCE character portraits with their name
// printed underneath (see sources/README.md for provenance). This script
// crops out each individual portrait (BOXES below), discards the printed
// name text (the plugin renders the name itself, as a real label, so it
// reads correctly on the e-ink font instead of a tiny anti-aliased colour
// screenshot font), and nearest-neighbour upscales every crop to a common
// height so they sit at a consistent size in the template regardless of
// how large the source portrait happened to be.
//
// The portraits are already pixel art (game sprites), so unlike
// banksy/generate-gallery.mjs this does NOT grayscale/threshold anything -
// we keep them in colour and let TRMNL's own "image-dither" class do the
// fine-grained e-ink dithering at render time (see template.liquid).
//
// Run again after editing BOXES below: node plugins/broforce/generate-portraits.mjs

import sharp from "sharp";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCES_DIR = path.join(__dirname, "sources");
const OUT_DIR = path.join(__dirname, "portraits");

const PAD = 2; // pixels of extra margin kept around each detected box
const TARGET_HEIGHT = 200; // final PNG height (nearest-neighbour upscale, keeps crisp pixel edges)

// [sourceSheet, [x0, y0, x1, y1] (inclusive, pre-padding), slug, name, description]
const BROS = [
  [1, [40, 33, 103, 108], "rambro", "Rambro", "John Rambo"],
  [1, [178, 34, 233, 107], "brommando", "Brommando", "John Matrix from Commando"],
  [1, [310, 32, 369, 109], "ba-broracus", "B.A. Broracus", "B.A. Baracus"],
  [1, [441, 25, 506, 116], "brodell-walker", "Brodell Walker", "Cordell Walker"],
  [1, [580, 33, 635, 108], "bro-hard", "Bro Hard", "John McClane from Die Hard"],

  [2, [45, 47, 106, 124], "macbrover", "MacBrover", "Angus MacGyver"],
  [2, [181, 49, 238, 122], "brade", "Brade", "Blade"],
  [2, [311, 50, 376, 121], "bro-dredd", "Bro Dredd", "Judge Dredd"],
  [2, [452, 47, 503, 124], "bro-in-black", "Bro in Black", "James Edwards (Agent J) from Men in Black"],
  [2, [583, 48, 640, 123], "snake-broskin", "Snake Broskin", "Snake Plissken"],

  [3, [45, 29, 102, 126], "dirty-brory", "Dirty Brory", '"Dirty" Harry Callahan'],
  [3, [179, 41, 236, 114], "brominator", "Brominator", "T-800 from the Terminator franchise"],
  [3, [312, 41, 371, 114], "brobocop", "Brobocop", "Alex Murphy from RoboCop"],
  [3, [443, 35, 508, 120], "indianna-brones", "Indianna Brones", "Indiana Jones"],
  [3, [583, 37, 636, 118], "ash-brolliams", "Ash Brolliams", "Ash Williams from The Evil Dead"],

  [4, [45, 17, 101, 108], "mr-anderbro", "Mr. Anderbro", "Thomas A. Anderson / Neo"],
  [4, [155, 8, 260, 117], "boondock-bros", "Boondock Bros", "Connor and Murphy MacManus from The Boondock Saints"],
  [4, [312, 23, 371, 102], "brochete", "Brochete", "Machete Cortez from Machete"],
  [4, [443, 24, 508, 101], "bronan-the-brobarian", "Bronan the Brobarian", "Conan the Barbarian"],
  [4, [582, 22, 637, 103], "ellen-ripbro", "Ellen Ripbro", "Ellen Ripley from Alien"],

  [5, [33, 17, 121, 153], "brocketeer", "Brocketeer", "Cliff Secord from The Rocketeer"],
  [5, [168, 29, 254, 141], "timebro", "TimeBro", "Max Walker from Timecop"],
  [5, [300, 28, 390, 143], "broniversal-soldier", "Broniversal Soldier", "Luc Deveraux / GR44 from Universal Soldier"],
  [5, [434, 23, 525, 148], "col-james-broddock", "Col. James Broddock", "Colonel James Braddock from Missing in Action"],
  [5, [568, 26, 658, 144], "cherry-broling", "Cherry Broling", "Cherry Darling from Planet Terror"],

  [6, [52, 18, 133, 142], "bro-max", "Bro Max", "Max Rockatansky from Mad Max"],
  [6, [181, 19, 271, 141], "the-brode", "The Brode", "Beatrix Kiddo / The Bride"],
  [6, [319, 21, 402, 140], "double-bro-seven", "Double Bro Seven", "James Bond / 007"],
  [6, [447, 17, 541, 144], "brodator", "Brodator", "Predator"],
  [6, [598, 37, 659, 124], "broheart", "Broheart", "William Wallace from Braveheart"],

  [7, [109, 17, 162, 98], "the-brofessional", "The Brofessional", 'Leon "Leon" Montana from The Professional'],
  [7, [241, 17, 298, 98], "broden", "Broden", "Raiden"],
  [7, [375, 17, 432, 98], "brolander", "Brolander", "Connor MacLeod / Highlander"],
  [7, [508, 16, 567, 99], "tank-bro", "Tank Bro", "Rebecca Buck / Tank Girl"],
  [7, [644, 12, 699, 103], "bro-lee", "Bro Lee", "Lee from Enter the Dragon / Bruce Lee"],

  [8, [31, 11, 152, 172], "broney-ross", "Broney Ross", "Barney Ross (The Expendabros)"],
  [8, [165, 11, 286, 172], "lee-broxmas", "Lee Broxmas", "Lee Christmas (The Expendabros)"],
  [8, [299, 11, 420, 172], "bronnar-jensen", "Bronnar Jensen", "Gunner Jensen (The Expendabros)"],
  [8, [433, 11, 554, 172], "bro-caesar", "Bro Caesar", "Hale Caesar (The Expendabros)"],
  [8, [567, 11, 688, 172], "broctor-death", "Broctor Death", "Doc (The Expendabros)"],

  [9, [2, 4, 123, 165], "toll-broad", "Toll Broad", "Toll Road (The Expendabros)"],
  [9, [136, 4, 251, 165], "trent-broser", "Trent Broser", "Trench Mauser (The Expendabros)"],
];

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const sheetMeta = {};
  const manifest = [];

  for (const [sheet, box, slug, name, description] of BROS) {
    const sheetPath = path.join(SOURCES_DIR, `${sheet}.png`);
    if (!sheetMeta[sheet]) {
      sheetMeta[sheet] = await sharp(sheetPath).metadata();
    }
    const { width: sw, height: sh } = sheetMeta[sheet];

    const [x0, y0, x1, y1] = box;
    const cx0 = Math.max(0, x0 - PAD);
    const cy0 = Math.max(0, y0 - PAD);
    const cx1 = Math.min(sw, x1 + PAD + 1);
    const cy1 = Math.min(sh, y1 + PAD + 1);
    const cropWidth = cx1 - cx0;
    const cropHeight = cy1 - cy0;

    const outWidth = Math.max(1, Math.round((cropWidth / cropHeight) * TARGET_HEIGHT));

    const png = await sharp(sheetPath)
      .extract({ left: cx0, top: cy0, width: cropWidth, height: cropHeight })
      .flatten({ background: "#000000" }) // source crops are fully opaque already; guards against stray alpha
      .resize({ width: outWidth, height: TARGET_HEIGHT, kernel: "nearest" })
      .png()
      .toBuffer();

    await writeFile(path.join(OUT_DIR, `${slug}.png`), png);
    manifest.push({ slug, name, description, file: `${slug}.png`, width: outWidth, height: TARGET_HEIGHT });
    console.log(`Wrote portraits/${slug}.png (${outWidth}x${TARGET_HEIGHT})`);
  }

  await writeFile(path.join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`\nWrote ${manifest.length} portraits + manifest.json to plugins/broforce/portraits/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
