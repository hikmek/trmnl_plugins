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

import { writeFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchWithRetry } from "../../lib/http.mjs";
import { shouldSkipDailyFetch } from "../../lib/throttle.mjs";

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

// "Hemmamat" (home food) - a weekend-only home-cooked menu the family keeps
// in a shared Google Sheet (Lördag/Söndag, Lunch/Middag columns, one row
// per ISO week number). Shared as "Anyone with the link" -> Viewer, so the
// gviz/tq endpoint below returns CSV with no auth/API key needed - same
// no-credentials approach as every other plugin in this repo.
const HEMMAMAT_SHEET_ID = "1z0fEGn4A9hKnX-EZ9GycGjbZV_k0jb1_8mA-BRJrUqY";
const HEMMAMAT_CSV_URL = `https://docs.google.com/spreadsheets/d/${HEMMAMAT_SHEET_ID}/gviz/tq?tqx=out:csv&gid=0`;

// "Dagens kock" (today's chef) - a third, unrelated-in-content but same-
// mechanism section: reuses the broforce plugin's own portrait roster
// (read straight from its committed manifest.json - no network call, both
// plugins live in this same repo) and picks one at random, same as
// broforce/fetch.mjs does for its own "Bro of the day". This pick is
// independent of broforce's own daily pick - lunch-lerum draws its own
// random Bro each day, not necessarily the same one broforce shows.
const DAGENS_KOCK_MANIFEST_PATH = path.join(__dirname, "..", "broforce", "portraits", "manifest.json");
const DAGENS_KOCK_BASE_URL = "https://hikmek.github.io/trmnl_plugins/broforce/portraits";

// broforce's own manifest.json only carries an English description (it's
// shared with broforce's own Full view, which stays English). Dagens kock
// is lunch-lerum-only content, so the Swedish translation lives here
// rather than touching broforce's manifest/generator. Keyed by slug so it
// survives manifest regeneration as long as slugs stay stable; falls back
// to the English text (see pickDagensKock()) for any future bro added to
// the roster before a translation is added here.
const DAGENS_KOCK_DESCRIPTIONS_SV = {
  rambro: "John Rambo",
  brommando: "John Matrix från Commando",
  "ba-broracus": "B.A. Baracus",
  "brodell-walker": "Cordell Walker",
  "bro-hard": "John McClane från Die Hard",
  macbrover: "Angus MacGyver",
  brade: "Blade",
  "bro-dredd": "Domare Dredd",
  "bro-in-black": "James Edwards (Agent J) från Men in Black",
  "snake-broskin": "Snake Plissken",
  "dirty-brory": "\"Dirty\" Harry Callahan",
  brominator: "T-800 från Terminator-filmerna",
  brobocop: "Alex Murphy från RoboCop",
  "indianna-brones": "Indiana Jones",
  "ash-brolliams": "Ash Williams från Evil Dead",
  "mr-anderbro": "Thomas A. Anderson / Neo",
  "boondock-bros": "Connor och Murphy MacManus från Boondock Saints",
  brochete: "Machete Cortez från Machete",
  "bronan-the-brobarian": "Conan Barbaren",
  "ellen-ripbro": "Ellen Ripley från Alien",
  brocketeer: "Cliff Secord från Rocketeer",
  timebro: "Max Walker från Timecop",
  "broniversal-soldier": "Luc Deveraux / GR44 från Universal Soldier",
  "col-james-broddock": "Överste James Braddock från Missing in Action",
  "cherry-broling": "Cherry Darling från Planet Terror",
  "bro-max": "Max Rockatansky från Mad Max",
  "the-brode": "Beatrix Kiddo / Bruden",
  "double-bro-seven": "James Bond / 007",
  brodator: "Predatorn",
  broheart: "William Wallace från Braveheart",
  "the-brofessional": "Leon Montana från filmen Leon",
  broden: "Raiden",
  brolander: "Connor MacLeod / Highlander",
  "tank-bro": "Rebecca Buck / Tank Girl",
  "bro-lee": "Lee från Enter the Dragon / Bruce Lee",
  "broney-ross": "Barney Ross (The Expendabros)",
  "lee-broxmas": "Lee Christmas (The Expendabros)",
  "bronnar-jensen": "Gunner Jensen (The Expendabros)",
  "bro-caesar": "Hale Caesar (The Expendabros)",
  "broctor-death": "Doc (The Expendabros)",
  "toll-broad": "Toll Road (The Expendabros)",
  "trent-broser": "Trench Mauser (The Expendabros)",
};

async function pickDagensKock() {
  try {
    const manifest = JSON.parse(await readFile(DAGENS_KOCK_MANIFEST_PATH, "utf8"));
    if (!manifest.length) return null;
    const pick = manifest[Math.floor(Math.random() * manifest.length)];
    return {
      slug: pick.slug,
      name: pick.name,
      description: DAGENS_KOCK_DESCRIPTIONS_SV[pick.slug] || pick.description,
      image_url: `${DAGENS_KOCK_BASE_URL}/${pick.file}`,
    };
  } catch (err) {
    console.error(`Could not pick Dagens kock from broforce roster - skipping: ${err.message}`);
    return null;
  }
}

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

// ISO 8601 week number (weeks start Monday, week 1 contains the year's
// first Thursday) for the given Y/M/D - matches the "vecka" numbering used
// in the hemmamat sheet. Takes plain calendar parts (not a Date+timezone)
// so it's unambiguous: the caller resolves "today in Stockholm" to a
// calendar date first, then this only ever does calendar math on it.
function isoWeekNumber(year, month, day) {
  const d = new Date(Date.UTC(year, month - 1, day));
  const isoDayNum = d.getUTCDay() || 7; // Monday=1 .. Sunday=7
  d.setUTCDate(d.getUTCDate() + 4 - isoDayNum); // shift to this week's Thursday
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

// Minimal general-purpose CSV parser (quoted fields, "" for an escaped
// quote) - enough for the gviz/tq CSV export below without adding a
// dependency for one small sheet.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// Fetches the hemmamat sheet and returns { vecka, lordag: {lunch, middag},
// sondag: {lunch, middag} } for the given ISO week, or null if the sheet
// is unreachable or has no row for that week yet - non-fatal either way,
// so a hiccup here never takes down the skolmat data.
async function fetchHemmamatForWeek(weekNumber) {
  try {
    const res = await fetchWithRetry(HEMMAMAT_CSV_URL, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) throw new Error(`hemmamat sheet request failed: ${res.status} ${res.statusText}`);
    const rows = parseCsv(await res.text());
    const dataRows = rows.slice(1); // drop header row
    const match = dataRows.find((r) => Number(String(r[0]).trim()) === weekNumber);
    if (!match) return null;
    const cell = (i) => (match[i] ? match[i].trim() : "") || null;
    return {
      vecka: weekNumber,
      lordag: { lunch: cell(1), middag: cell(2) },
      sondag: { lunch: cell(3), middag: cell(4) },
    };
  } catch (err) {
    console.error(`Could not fetch hemmamat sheet - showing skolmat only: ${err.message}`);
    return null;
  }
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

// "Data uppdaterad <weekday> <day> <month>", all in Swedish, e.g.
// "Data uppdaterad onsdag 9 september".
function formatUpdatedDayDate(nowMs, timeZone) {
  const now = new Date(nowMs);
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? "";
  return `Data uppdaterad ${get("weekday")} ${get("day")} ${get("month")}`;
}

async function main() {
  // Calendar-day-aware throttle (not just "23h since last fetch"): this
  // guarantees a fresh fetch happens promptly once the Europe/Stockholm
  // date actually changes, so "today's lunch" never keeps showing
  // yesterday's dish for a stretch after midnight.
  if (await shouldSkipDailyFetch(LIVE_DATA_URL, (json) => json.today?.date, TIMEZONE)) {
    console.log("Skipping lunch-lerum fetch - already have today's menu published");
    return;
  }

  const html = await fetchHtml();
  const days = parseDays(html);
  days.sort((a, b) => a.date.localeCompare(b.date));

  const todayKey = todayKeyStockholm();
  const todayIndex = days.findIndex((d) => d.date === todayKey);

  const fallbackWeekday = WEEKDAYS[(new Date(todayKey).getUTCDay() + 6) % 7];
  const isWeekend = fallbackWeekday === "Lördag" || fallbackWeekday === "Söndag";

  // Hemmamat is shown as its own always-present column now (not just on
  // the weekend it covers), with BOTH Lördag and Söndag side by side - so
  // it's fetched every day, for whichever ISO week "today" falls in. ISO
  // weeks run Monday-Sunday, so a weekday's current week already IS the
  // week containing its upcoming Lördag/Söndag - no special-casing needed.
  const [todayYear, todayMonth, todayDay] = todayKey.split("-").map(Number);
  const weekNumber = isoWeekNumber(todayYear, todayMonth, todayDay);
  const hemmamat = await fetchHemmamatForWeek(weekNumber); // { vecka, lordag: {lunch, middag}, sondag: {...} } or null

  // Independent of weekday/weekend - picked fresh once a day, same as
  // everything else in this function (gated by the shouldSkipDailyFetch
  // check above).
  const dagensKock = await pickDagensKock();

  const today =
    todayIndex >= 0
      ? { ...days[todayIndex], is_weekend: false, hemmamat, dagens_kock: dagensKock } // real published school days are always weekdays
      : {
          date: todayKey,
          weekday: fallbackWeekday,
          is_weekend: isWeekend,
          // Weekends never have a published menu (school's out) - that's
          // expected, not a scraping gap, so it gets its own Swedish note
          // instead of the generic "no menu found" message below (which is
          // for real gaps: a weekday that's out of term range, or a date
          // the page just doesn't have yet).
          note: isWeekend ? "HELGn = Ingen skolmatn" : "No menu published for this date",
          lunch: null,
          lunch_icon_url: null,
          vegetarian: null,
          vegetarian_icon_url: null,
          hemmamat,
          dagens_kock: dagensKock,
        };

  const upcoming =
    todayIndex >= 0 ? days.slice(todayIndex + 1, todayIndex + 1 + LOOKAHEAD_DAYS) : [];

  const output = {
    plugin: "lunch-lerum",
    source_url: SOURCE_URL,
    term: TERM_LABEL,
    generated_at: new Date().toISOString(),
    updated_display: formatUpdatedDayDate(Date.now(), TIMEZONE),
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
