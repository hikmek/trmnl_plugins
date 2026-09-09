// TRMNL Plugin #2: School lunch menu (Lerums kommun)
//
// Scrapes the municipality's published lunch menu page for grundskola/
// gymnasium and picks out today's lunch (Europe/Stockholm date), plus a
// short look-ahead. The page is plain server-rendered HTML (no API), so we
// parse it directly.
//
// NOTE: The source URL is specific to one school term (Höstterminen 2026).
// When a new term's menu is published at a new URL, update SOURCE_URL (and
// TERM_YEAR/TERM_LABEL) below.

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchWithRetry } from "../../lib/http.mjs";
import { shouldSkipFetch } from "../../lib/throttle.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SOURCE_URL =
  "https://lerum.se/utbildning-och-barnomsorg/gemensamt-for-forskolor-och-skolor-i-lerums-kommun/maltider/matsedel-grundskola-och-gymnasium-hostterminen-2026";
const TERM_LABEL = "Höstterminen 2026";
const TERM_YEAR = 2026; // all dates on this page fall within this calendar year

const TIMEZONE = "Europe/Stockholm";
const LOOKAHEAD_DAYS = 4; // school days shown after today, in addition to today
const OUTPUT_PATH = path.join(__dirname, "..", "..", "public", "lunch-lerum", "data.json");

const USER_AGENT = "trmnl-plugins-hikmek/1.0 github.com/hikmek/trmnl_plugins";

const SWEDISH_MONTHS = {
  januari: 0,
  februari: 1,
  mars: 2,
  april: 3,
  maj: 4,
  juni: 5,
  juli: 6,
  augusti: 7,
  september: 8,
  oktober: 9,
  november: 10,
  december: 11,
};

const WEEKDAYS = ["Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag", "Lördag", "Söndag"];

const ICON_BASE_URL = "https://hikmek.github.io/trmnl_plugins/lunch-lerum/icons";

// Extensible keyword -> icon mapping. First match wins, so more specific /
// more visually distinctive categories are listed first (e.g. "köttbullar"
// before "pasta", so "Kycklingköttbullar serveras med pasta" shows
// meatballs rather than pasta). Any dish that matches nothing falls back
// to "generic" (a plain bowl) in iconForDish() below, so every dish that
// exists always gets *some* icon.
const FOOD_ICON_KEYWORDS = [
  { pattern: /köttbullar|kottbullar/i, icon: "meatballs" },
  { pattern: /spaghetti|pasta|lasagn|nudlar|nudel|penne/i, icon: "pasta" },
  { pattern: /korv/i, icon: "sausage" },
  { pattern: /fisk|lax|sej/i, icon: "fish" },
  { pattern: /kyckling/i, icon: "chicken" },
  { pattern: /ris/i, icon: "rice" },
  { pattern: /taco/i, icon: "taco" },
  { pattern: /soppa|buffe|buffé|julbord/i, icon: "soup" },
  { pattern: /paj/i, icon: "pie" },
  { pattern: /pannkaka/i, icon: "pancake" },
  { pattern: /gryta|curry|gulasch|chili/i, icon: "stew" },
  { pattern: /gratäng|moussaka/i, icon: "casserole" },
  { pattern: /färs/i, icon: "meatloaf" },
  // These two are checked last (after specific food types), so e.g.
  // "Kockens val av pastarätt" still shows pasta, but the truly generic
  // "Kockens val" / "Kockens gröna" (no specific food mentioned) falls
  // through to the chef-hat icon, and "Gästens val" to the people icon.
  { pattern: /kockens/i, icon: "chef" },
  { pattern: /gästens/i, icon: "people" },
];

function iconForDish(text) {
  if (!text) return null; // no dish at all - nothing to show an icon for
  const match = FOOD_ICON_KEYWORDS.find((k) => k.pattern.test(text));
  return match ? match.icon : "generic"; // always an icon for any real dish
}

function iconUrl(icon) {
  return icon ? `${ICON_BASE_URL}/${icon}.png` : null;
}

function stripTags(html) {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&aring;/g, "å")
    .replace(/&auml;/g, "ä")
    .replace(/&ouml;/g, "ö")
    .replace(/&Aring;/g, "Å")
    .replace(/&Auml;/g, "Ä")
    .replace(/&Ouml;/g, "Ö")
    .replace(/\s+/g, " ")
    .trim();
}

function todayKeyStockholm() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function fetchHtml() {
  const res = await fetchWithRetry(SOURCE_URL, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    throw new Error(`lerum.se request failed: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

/**
 * Parses each `<h3 class="subheading3">...</h3>` (a single day) plus its
 * optional following `<ul class=" env-text-list normal">...</ul>` (the
 * lunch/vegetarian items for that day, if published).
 */
function parseDays(html) {
  const dayBlockRe =
    /<h3 class="subheading3"[^>]*>(.*?)<\/h3>\s*(?:<ul class=" env-text-list normal">([\s\S]*?)<\/ul>)?/g;

  const dayHeadingRe = new RegExp(
    `^(${WEEKDAYS.join("|")})\\s+(\\d{1,2})\\s+([A-Za-zÅÄÖåäö]+)(?:\\s+(.*))?$`
  );

  const days = [];
  let match;
  while ((match = dayBlockRe.exec(html))) {
    const headingText = stripTags(match[1]);
    const ulHtml = match[2] || "";

    const headingMatch = dayHeadingRe.exec(headingText);
    if (!headingMatch) continue; // skip anything that isn't a real "Weekday D Month [note]" heading

    const [, weekday, dayNumStr, monthNameRaw, note] = headingMatch;
    const monthKey = monthNameRaw.toLowerCase();
    const monthIndex = SWEDISH_MONTHS[monthKey];
    if (monthIndex === undefined) continue; // unrecognized month, skip defensively

    const dayNum = Number(dayNumStr);
    const date = `${TERM_YEAR}-${String(monthIndex + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;

    let lunch = null;
    let vegetarian = null;
    const liRe = /<li>([\s\S]*?)<\/li>/g;
    let liMatch;
    while ((liMatch = liRe.exec(ulHtml))) {
      const text = stripTags(liMatch[1]);
      if (/^Dagens\s+Lunch/i.test(text)) {
        lunch = text.replace(/^Dagens\s+Lunch\s*/i, "").trim() || null;
      } else if (/^Dagens\s+Gr[öo]na/i.test(text)) {
        vegetarian = text.replace(/^Dagens\s+Gr[öo]na\s*/i, "").trim() || null;
      }
    }

    const lunchIcon = iconForDish(lunch);
    const vegetarianIcon = iconForDish(vegetarian);

    days.push({
      date,
      weekday,
      note: note ? note.trim() : null,
      lunch,
      lunch_icon_url: iconUrl(lunchIcon),
      vegetarian,
      vegetarian_icon_url: iconUrl(vegetarianIcon),
    });
  }

  return days;
}

export { parseDays, fetchHtml };

const LIVE_DATA_URL = "https://hikmek.github.io/trmnl_plugins/lunch-lerum/data.json";
const MIN_INTERVAL_MINUTES = 1380; // ~once a day (23h; a bit under 24h to absorb schedule jitter) - the menu for a given day doesn't change during the day anyway

async function main() {
  if (await shouldSkipFetch(LIVE_DATA_URL, MIN_INTERVAL_MINUTES)) {
    console.log(`Skipping lunch-lerum fetch - last update was less than ${MIN_INTERVAL_MINUTES} min ago`);
    return;
  }

  const html = await fetchHtml();
  const days = parseDays(html);
  days.sort((a, b) => a.date.localeCompare(b.date));

  const todayKey = todayKeyStockholm();
  const todayIndex = days.findIndex((d) => d.date === todayKey);

  const today =
    todayIndex >= 0
      ? days[todayIndex]
      : {
          date: todayKey,
          weekday: WEEKDAYS[(new Date(todayKey).getUTCDay() + 6) % 7],
          note: "No menu published for this date",
          lunch: null,
          lunch_icon_url: null,
          vegetarian: null,
          vegetarian_icon_url: null,
        };

  const upcoming =
    todayIndex >= 0 ? days.slice(todayIndex + 1, todayIndex + 1 + LOOKAHEAD_DAYS) : [];

  const output = {
    plugin: "lunch-lerum",
    source_url: SOURCE_URL,
    term: TERM_LABEL,
    generated_at: new Date().toISOString(),
    today,
    upcoming,
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
