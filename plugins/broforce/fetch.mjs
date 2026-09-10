// TRMNL Plugin #5: Broforce - Bro of the Day
//
// Picks one random BROFORCE character portrait from the pre-generated
// plugins/broforce/portraits/ set (see generate-portraits.mjs for how those
// are made) and writes a tiny JSON pointing TRMNL at the chosen portrait's
// public URL. Throttled to once per calendar day (Europe/Stockholm) via
// shouldSkipDailyFetch, so the same Bro shows all day and a new one is
// picked shortly after midnight - not on every 5-minute workflow run.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { shouldSkipDailyFetch } from "../../lib/throttle.mjs";
import { formatUpdatedDisplay } from "../../lib/format.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.join(__dirname, "portraits", "manifest.json");
const OUTPUT_PATH = path.join(__dirname, "..", "..", "public", "broforce", "data.json");

const PUBLIC_BASE_URL = "https://hikmek.github.io/trmnl_plugins/broforce/portraits";
const LIVE_DATA_URL = "https://hikmek.github.io/trmnl_plugins/broforce/data.json";
const TIMEZONE = "Europe/Stockholm";

function todayKey(timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function main() {
  // Calendar-day-aware throttle: only pick a new Bro once the Stockholm
  // date actually rolls over, regardless of how the 5-minute workflow
  // schedule happens to land.
  if (await shouldSkipDailyFetch(LIVE_DATA_URL, (json) => json.date, TIMEZONE)) {
    console.log("Skipping broforce fetch - already have today's Bro published");
    return;
  }

  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  if (!manifest.length) {
    throw new Error("portraits/manifest.json is empty - run generate-portraits.mjs first");
  }

  const pick = manifest[Math.floor(Math.random() * manifest.length)];

  const output = {
    plugin: "broforce",
    generated_at: new Date().toISOString(),
    date: todayKey(TIMEZONE),
    updated_display: formatUpdatedDisplay(Date.now(), TIMEZONE),
    bro: {
      slug: pick.slug,
      name: pick.name,
      description: pick.description,
      image_url: `${PUBLIC_BASE_URL}/${pick.file}`,
    },
    roster_size: manifest.length,
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
